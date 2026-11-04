import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";

export const VISUAL_CONTRACT_VERSION=2;
export const VISUAL_MAX_BYTES=8*1024*1024;
export const VISUAL_COVER_PREFIX="https://raw.githubusercontent.com/newsdayads/tigeriq-media-content/main/covers/";
export const OWNED_VISUAL_LICENSE_URL="https://github.com/newsdayads/tigeriq-media-content/blob/main/docs/OWNED_VISUAL_LICENSE.md";
export const VISUAL_RIGHTS_MATRIX=Object.freeze({
  "publisher-licensed":Object.freeze({allowed:true,classes:["publisher-licensed-asset"],ai:false}),
  "owned-original":Object.freeze({allowed:true,classes:["owned-photo","owned-illustration"],ai:false}),
  "ai-generated-licensed":Object.freeze({allowed:true,classes:["ai-illustration"],ai:true}),
  "unknown":Object.freeze({allowed:false,classes:[],ai:null}),
  "web-scrape":Object.freeze({allowed:false,classes:[],ai:null}),
  "stock-unverified":Object.freeze({allowed:false,classes:[],ai:null})
});
const LOCALES=["vi","en","es"];
const AI_LABELS={
  vi:"Ảnh minh họa tạo bằng AI",
  en:"AI-generated illustration",
  es:"Ilustración generada por IA"
};

function httpsUrl(value){
  try{
    const u=new URL(value);
    return u.protocol==="https:"&&!u.username&&!u.password?u:null;
  }catch{return null;}
}
function metaAttributes(tag){
  const out=new Map();
  const attr=/\s+([A-Za-z_:][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for(const match of tag.matchAll(attr))out.set(match[1].toLowerCase(),match[2]??match[3]??"");
  return out;
}
function metaValue(html,key){
  for(const tag of String(html).match(/<meta\b[^>]*>/gi)||[]){
    const attrs=metaAttributes(tag);
    const name=(attrs.get("property")||attrs.get("name")||"").toLowerCase();
    if(name===key.toLowerCase()&&attrs.has("content"))return attrs.get("content").trim();
  }
  return "";
}
function licenseHref(html,base){
  for(const tag of String(html).match(/<link\b[^>]*>/gi)||[]){
    const attrs=metaAttributes(tag);
    const rel=(attrs.get("rel")||"").toLowerCase().split(/\s+/);
    if(!rel.includes("license")||!attrs.get("href"))continue;
    try{
      const u=new URL(attrs.get("href"),base);
      if(u.protocol==="https:"&&!u.username&&!u.password)return u.href;
    }catch{}
  }
  return "";
}
function localizedText(value,isAi,owner){
  const clean=String(value||"").replace(/\s+/g," ").trim();
  if(!clean)return null;
  if(isAi)return {
    alt:{vi:clean,en:clean,es:clean},
    caption:{
      vi:AI_LABELS.vi+". "+clean,
      en:AI_LABELS.en+". "+clean,
      es:AI_LABELS.es+". "+clean
    }
  };
  return {
    alt:{vi:clean,en:clean,es:clean},
    caption:{
      vi:"Ảnh do "+owner+" cung cấp. "+clean,
      en:"Image provided by "+owner+". "+clean,
      es:"Imagen proporcionada por "+owner+". "+clean
    }
  };
}

/**
 * Discover only strongly disclosed publisher visuals. Generic og:image alone is
 * never sufficient rights evidence. Missing license/copyright/AI disclosure
 * returns null so the publisher can fail closed without a paid image call.
 */
export function extractPublisherVisualDisclosure(html,articleUrl){
  const article=httpsUrl(articleUrl);
  if(!article)return null;
  const assetRaw=metaValue(html,"og:image:secure_url")||metaValue(html,"og:image");
  let asset;
  try{asset=new URL(assetRaw,article);}catch{return null;}
  if(asset.protocol!=="https:"||asset.username||asset.password)return null;
  const mime=(metaValue(html,"og:image:type")||"").toLowerCase().split(";")[0].trim();
  if(!["image/jpeg","image/webp"].includes(mime))return null;
  const width=Number(metaValue(html,"og:image:width"));
  const height=Number(metaValue(html,"og:image:height"));
  const alt=metaValue(html,"og:image:alt");
  const owner=metaValue(html,"copyright")||metaValue(html,"dc.rights");
  const author=metaValue(html,"author")||owner;
  const license=licenseHref(html,article.href);
  const aiRaw=(metaValue(html,"ai-generated")||metaValue(html,"x-ai-generated")).toLowerCase();
  if(!owner||!author||!license||!alt||!Number.isInteger(width)||!Number.isInteger(height)||
    !["true","false"].includes(aiRaw))return null;
  const isAIGenerated=aiRaw==="true";
  const locale=localizedText(alt,isAIGenerated,owner);
  return {
    assetUrl:asset.href,mime,declaredWidth:width,declaredHeight:height,
    assetClass:isAIGenerated?"ai-illustration":"publisher-licensed-asset",
    rightsClass:isAIGenerated?"ai-generated-licensed":"publisher-licensed",
    rightsVerified:true,owner,author,license,rightsEvidenceUrl:license,
    originalSource:article.href,attribution:owner,isAIGenerated,
    alt:locale.alt,caption:locale.caption,sourceAlt:alt
  };
}

function jpegDimensions(bytes){
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  let offset=2;
  const sof=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  while(offset+3<bytes.length){
    if(bytes[offset]!==0xff){offset++;continue;}
    while(offset<bytes.length&&bytes[offset]===0xff)offset++;
    const marker=bytes[offset++];
    if(marker===0xd9||marker===0xda)break;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    if(offset+1>=bytes.length)return null;
    const len=(bytes[offset]<<8)|bytes[offset+1];
    if(len<2||offset+len>bytes.length)return null;
    if(sof.has(marker)){
      if(len<7)return null;
      const height=(bytes[offset+3]<<8)|bytes[offset+4];
      const width=(bytes[offset+5]<<8)|bytes[offset+6];
      return width>0&&height>0?{width,height}:null;
    }
    offset+=len;
  }
  return null;
}
function uint24le(bytes,offset){
  return bytes[offset]|(bytes[offset+1]<<8)|(bytes[offset+2]<<16);
}
function webpDimensions(bytes){
  if(bytes.length<30||String.fromCharCode(...bytes.slice(0,4))!=="RIFF"||
    String.fromCharCode(...bytes.slice(8,12))!=="WEBP")return null;
  const chunk=String.fromCharCode(...bytes.slice(12,16));
  if(chunk==="VP8X"){
    return {width:1+uint24le(bytes,24),height:1+uint24le(bytes,27)};
  }
  if(chunk==="VP8L"&&bytes[20]===0x2f){
    const b0=bytes[21],b1=bytes[22],b2=bytes[23],b3=bytes[24];
    return {width:1+b0+((b1&0x3f)<<8),
      height:1+((b1&0xc0)>>6)+(b2<<2)+((b3&0x0f)<<10)};
  }
  if(chunk==="VP8 "&&bytes[23]===0x9d&&bytes[24]===0x01&&bytes[25]===0x2a){
    return {width:(bytes[26]|(bytes[27]<<8))&0x3fff,
      height:(bytes[28]|(bytes[29]<<8))&0x3fff};
  }
  return null;
}
export function rasterDimensions(input,mime){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  return mime==="image/jpeg"?jpegDimensions(bytes):
    mime==="image/webp"?webpDimensions(bytes):null;
}
export function visualExtension(mime){
  if(mime==="image/jpeg")return "jpg";
  if(mime==="image/webp")return "webp";
  throw Error("VISUAL_MIME_UNSUPPORTED");
}

function personalizeOwnedJpeg(input,sourceKey){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8||
    bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9)
    throw Error("VISUAL_OWNED_RASTER_INVALID");
  const digest=createHash("sha256").update(String(sourceKey||"")).digest("hex").slice(0,32);
  const payload=Buffer.from("TigerIQ-owned-original:"+digest,"utf8");
  const length=payload.length+2;
  const marker=Buffer.from([0xff,0xfe,(length>>8)&0xff,length&0xff]);
  return new Uint8Array(Buffer.concat([
    Buffer.from(bytes.subarray(0,bytes.length-2)),marker,payload,Buffer.from([0xff,0xd9])
  ]));
}

function runOwnedRasterizer(svg,spawnSyncImpl){
  const attempts=[
    ["convert",["svg:-","-strip","-quality","82","jpeg:-"]],
    ["magick",["convert","svg:-","-strip","-quality","82","jpeg:-"]]
  ];
  for(const [command,args] of attempts){
    const result=spawnSyncImpl(command,args,{input:svg,encoding:null,maxBuffer:VISUAL_MAX_BYTES+1024*1024});
    if(!result?.error&&result?.status===0&&result.stdout?.length>0)return new Uint8Array(result.stdout);
    if(result?.error?.code!=="ENOENT"&&command==="convert")break;
  }
  throw Error("VISUAL_OWNED_RASTERIZER_UNAVAILABLE");
}

export function buildOwnedOriginalRasterAsset(svg,{title,sourceUrl,sourceKey,priorArticles=[],spawnSyncImpl=spawnSync}={}){
  const source=httpsUrl(sourceUrl);
  if(!source)throw Error("VISUAL_OWNED_SOURCE_INVALID");
  const cleanTitle=String(title||"").replace(/\s+/g," ").trim().slice(0,180);
  if(cleanTitle.length<8)throw Error("VISUAL_OWNED_TITLE_INVALID");
  const rendered=runOwnedRasterizer(String(svg||""),spawnSyncImpl);
  const bytes=personalizeOwnedJpeg(rendered,sourceKey||source.href);
  const dimensions=rasterDimensions(bytes,"image/jpeg");
  if(!dimensions||dimensions.width!==1200||dimensions.height!==675)
    throw Error("VISUAL_OWNED_DIMENSIONS_INVALID");
  const sha256=createHash("sha256").update(bytes).digest("hex");
  if(priorArticles.some(article=>article?.cover?.sha256===sha256))
    throw Error("VISUAL_DUPLICATE_ASSET");
  const candidate={
    generated:true,assetClass:"owned-illustration",rightsClass:"owned-original",rightsVerified:true,
    owner:"TigerIQ Media",author:"TigerIQ Newsroom procedural illustration renderer",
    license:OWNED_VISUAL_LICENSE_URL,rightsEvidenceUrl:OWNED_VISUAL_LICENSE_URL,
    originalSource:source.href,attribution:"TigerIQ Media",isAIGenerated:false,
    alt:{
      vi:"Minh họa công nghệ gốc của TigerIQ cho: "+cleanTitle,
      en:"Original TigerIQ technology illustration for: "+cleanTitle,
      es:"Ilustración tecnológica original de TigerIQ para: "+cleanTitle
    },
    caption:{
      vi:"Minh họa gốc do TigerIQ Media tạo nội bộ. "+cleanTitle,
      en:"Original illustration created in-house by TigerIQ Media. "+cleanTitle,
      es:"Ilustración original creada internamente por TigerIQ Media. "+cleanTitle
    }
  };
  return {candidate,bytes,mime:"image/jpeg",width:dimensions.width,height:dimensions.height,
    sha256,sourceAssetUrl:null,extension:"jpg"};
}
function validLocaleMap(map){
  return map&&typeof map==="object"&&LOCALES.every(lang=>
    typeof map[lang]==="string"&&map[lang].trim().length>=8&&map[lang].length<=500);
}

export function validateVisualMetadata(cover,{slug,allowLegacy=false}={}){
  if(typeof slug!=="string"||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw Error("VISUAL_SLUG_INVALID");
  if(allowLegacy&&cover?.visualVersion==null&&cover?.generated===true&&
    cover?.url===VISUAL_COVER_PREFIX+slug+".svg")return {legacy:true,cover};
  if(cover?.visualVersion!==VISUAL_CONTRACT_VERSION)throw Error("VISUAL_VERSION_REQUIRED");
  if(!["image/jpeg","image/webp"].includes(cover.mime))throw Error("VISUAL_MIME_UNSUPPORTED");
  const extension=visualExtension(cover.mime);
  if(cover.url!==VISUAL_COVER_PREFIX+slug+"."+extension||cover.url.includes("?"))
    throw Error("VISUAL_CANONICAL_URL_REQUIRED");
  if(!Number.isInteger(cover.width)||!Number.isInteger(cover.height)||
    cover.width<1200||cover.height<675||Math.abs(cover.width/cover.height-16/9)>0.035)
    throw Error("VISUAL_DIMENSIONS_INVALID");
  if(!Number.isInteger(cover.bytes)||cover.bytes<256||cover.bytes>VISUAL_MAX_BYTES)
    throw Error("VISUAL_BYTES_INVALID");
  if(typeof cover.sha256!=="string"||!/^[a-f0-9]{64}$/.test(cover.sha256))
    throw Error("VISUAL_SHA256_INVALID");
  const rule=VISUAL_RIGHTS_MATRIX[cover.rightsClass];
  if(!rule?.allowed||!rule.classes.includes(cover.assetClass))
    throw Error("VISUAL_RIGHTS_CLASS_FORBIDDEN");
  if(cover.rightsVerified!==true)throw Error("VISUAL_RIGHTS_UNVERIFIED");
  for(const key of ["owner","author","license","attribution"]){
    if(typeof cover[key]!=="string"||cover[key].trim().length<2)throw Error("VISUAL_"+key.toUpperCase()+"_MISSING");
  }
  for(const key of ["originalSource","rightsEvidenceUrl","sourceAssetUrl"]){
    if(!httpsUrl(cover[key]))throw Error("VISUAL_"+key.toUpperCase()+"_INVALID");
  }
  if(typeof cover.isAIGenerated!=="boolean"||cover.isAIGenerated!==rule.ai)
    throw Error("VISUAL_AI_DISCLOSURE_INVALID");
  if(!validLocaleMap(cover.alt)||!validLocaleMap(cover.caption))
    throw Error("VISUAL_LOCALE_METADATA_INVALID");
  if(cover.isAIGenerated&&LOCALES.some(lang=>!cover.caption[lang].startsWith(AI_LABELS[lang])))
    throw Error("VISUAL_AI_LABEL_MISSING");
  return {legacy:false,cover};
}

export function verifyRasterBytes(input,cover){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.byteLength!==cover.bytes)throw Error("VISUAL_BYTE_COUNT_MISMATCH");
  const digest=createHash("sha256").update(bytes).digest("hex");
  if(digest!==cover.sha256)throw Error("VISUAL_HASH_MISMATCH");
  const dimensions=rasterDimensions(bytes,cover.mime);
  if(!dimensions||dimensions.width!==cover.width||dimensions.height!==cover.height)
    throw Error("VISUAL_PIXEL_DIMENSIONS_MISMATCH");
  return {sha256:digest,...dimensions,bytes:bytes.byteLength};
}

async function readBoundedBinary(response,maxBytes=VISUAL_MAX_BYTES){
  const declared=response.headers?.get?.("content-length");
  if(typeof declared==="string"&&/^\d+$/.test(declared.trim())&&Number(declared)>maxBytes)
    throw Error("VISUAL_RESPONSE_TOO_LARGE");
  if(typeof response.arrayBuffer!=="function")throw Error("VISUAL_BINARY_BODY_REQUIRED");
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength>maxBytes)throw Error("VISUAL_RESPONSE_TOO_LARGE");
  return new Uint8Array(buffer);
}

export async function fetchVerifiedRasterAsset(candidate,{fetchImpl=fetch,priorArticles=[]}={}){
  if(!candidate||candidate.rightsVerified!==true)throw Error("VISUAL_RIGHTS_UNVERIFIED");
  const asset=httpsUrl(candidate.assetUrl);
  if(!asset)throw Error("VISUAL_ASSET_URL_INVALID");
  if(!["image/jpeg","image/webp"].includes(candidate.mime))throw Error("VISUAL_MIME_UNSUPPORTED");
  const response=await fetchImpl(asset.href,{redirect:"error",
    headers:{"user-agent":"TigerIQ-News/2.0","accept":"image/jpeg,image/webp"},
    signal:AbortSignal.timeout(15000)});
  if(response.status!==200)throw Error("VISUAL_HTTP_"+response.status);
  const mediaType=String(response.headers?.get?.("content-type")||"").split(";")[0].trim().toLowerCase();
  if(mediaType!==candidate.mime)throw Error("VISUAL_CONTENT_TYPE_MISMATCH");
  const bytes=await readBoundedBinary(response);
  const dimensions=rasterDimensions(bytes,mediaType);
  if(!dimensions)throw Error("VISUAL_RASTER_INVALID");
  if(dimensions.width!==candidate.declaredWidth||dimensions.height!==candidate.declaredHeight)
    throw Error("VISUAL_DECLARED_DIMENSIONS_MISMATCH");
  const sha256=createHash("sha256").update(bytes).digest("hex");
  if(priorArticles.some(article=>article?.cover?.sha256===sha256))
    throw Error("VISUAL_DUPLICATE_ASSET");
  return {candidate,bytes,mime:mediaType,width:dimensions.width,height:dimensions.height,
    sha256,sourceAssetUrl:asset.href,extension:visualExtension(mediaType)};
}

export function buildRasterCover(asset,{slug,verifiedAt=new Date().toISOString()}={}){
  if(!asset?.candidate||!(asset.bytes instanceof Uint8Array))throw Error("VISUAL_ASSET_INVALID");
  const candidate=asset.candidate;
  const cover={
    visualVersion:VISUAL_CONTRACT_VERSION,url:VISUAL_COVER_PREFIX+slug+"."+asset.extension,
    mime:asset.mime,width:asset.width,height:asset.height,bytes:asset.bytes.byteLength,sha256:asset.sha256,
    generated:candidate.generated===true||candidate.isAIGenerated===true,assetClass:candidate.assetClass,
    rightsClass:candidate.rightsClass,rightsVerified:true,owner:candidate.owner,author:candidate.author,
    originalSource:candidate.originalSource,sourceAssetUrl:candidate.rightsClass==="owned-original"
      ?VISUAL_COVER_PREFIX+slug+"."+asset.extension:asset.sourceAssetUrl,
    rightsEvidenceUrl:candidate.rightsEvidenceUrl,license:candidate.license,
    attribution:candidate.attribution,isAIGenerated:candidate.isAIGenerated,
    alt:candidate.alt,caption:candidate.caption,verifiedAt
  };
  validateVisualMetadata(cover,{slug});
  verifyRasterBytes(asset.bytes,cover);
  return cover;
}

export function isLegacySvgCover(article){
  try{return validateVisualMetadata(article?.cover,{slug:article?.slug,allowLegacy:true}).legacy===true;}
  catch{return false;}
}
