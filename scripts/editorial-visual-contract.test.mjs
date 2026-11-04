import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
  VISUAL_COVER_PREFIX,VISUAL_RIGHTS_MATRIX,extractPublisherVisualDisclosure,
  rasterDimensions,validateVisualMetadata,verifyRasterBytes,fetchVerifiedRasterAsset,buildRasterCover,
  validateVisualCandidate,readBoundedRasterBody
} from "./editorial-visual-contract.mjs";

function jpeg1200x675(){
  const bytes=new Uint8Array(300);
  let i=0;bytes[i++]=0xff;bytes[i++]=0xd8;
  bytes[i++]=0xff;bytes[i++]=0xc0;
  bytes[i++]=0x00;bytes[i++]=0x11;
  bytes[i++]=0x08;
  bytes[i++]=0x02;bytes[i++]=0xa3;
  bytes[i++]=0x04;bytes[i++]=0xb0;
  bytes[i++]=0x03;
  for(let c=0;c<9;c++)bytes[i++]=c;
  bytes[i++]=0xff;bytes[i++]=0xd9;
  return bytes;
}
const disclosureHtml=(ai="false")=>`<html><head>
<meta property="og:image" content="https://media.example.com/ai-cover.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="675">
<meta property="og:image:alt" content="Data center racks used for an AI infrastructure announcement">
<meta name="copyright" content="Example Publisher">
<meta name="author" content="Example Visual Desk">
<meta name="ai-generated" content="${ai}">
<link rel="license" href="https://example.com/media-license">
</head></html>`;

test("rights matrix allows only explicit publisher, owned and licensed AI classes",()=>{
  assert.equal(VISUAL_RIGHTS_MATRIX["publisher-licensed"].allowed,true);
  assert.equal(VISUAL_RIGHTS_MATRIX["owned-original"].allowed,true);
  assert.equal(VISUAL_RIGHTS_MATRIX["ai-generated-licensed"].allowed,true);
  assert.equal(VISUAL_RIGHTS_MATRIX.unknown.allowed,false);
  assert.equal(VISUAL_RIGHTS_MATRIX["web-scrape"].allowed,false);
  assert.equal(VISUAL_RIGHTS_MATRIX["stock-unverified"].allowed,false);
});

test("og:image alone is rejected; explicit license, copyright and AI disclosure are mandatory",()=>{
  assert.equal(extractPublisherVisualDisclosure(
    '<meta property="og:image" content="https://example.com/a.jpg">',"https://example.com/story"),null);
  const candidate=extractPublisherVisualDisclosure(disclosureHtml(),"https://example.com/story");
  assert.equal(candidate.rightsVerified,true);
  assert.equal(candidate.rightsClass,"publisher-licensed");
  assert.equal(candidate.isAIGenerated,false);
  assert.equal(candidate.license,"https://example.com/media-license");
  assert.equal(candidate.rightsEvidenceUrl,"https://example.com/media-license");
});

test("explicit AI image disclosure produces mandatory localized AI labels",()=>{
  const candidate=extractPublisherVisualDisclosure(disclosureHtml("true"),"https://example.com/story");
  assert.equal(candidate.rightsClass,"ai-generated-licensed");
  assert.match(candidate.caption.vi,/^Ảnh minh họa tạo bằng AI/);
  assert.match(candidate.caption.en,/^AI-generated illustration/);
  assert.match(candidate.caption.es,/^Ilustración generada por IA/);
});

test("JPEG dimensions and hash are verified from actual bytes, not metadata alone",()=>{
  const bytes=jpeg1200x675();
  assert.deepEqual(rasterDimensions(bytes,"image/jpeg"),{width:1200,height:675});
  const sha256=createHash("sha256").update(bytes).digest("hex");
  const cover={visualVersion:2,url:VISUAL_COVER_PREFIX+"story.jpg",mime:"image/jpeg",
    width:1200,height:675,bytes:bytes.length,sha256,generated:false,
    assetClass:"publisher-licensed-asset",rightsClass:"publisher-licensed",rightsVerified:true,
    owner:"Example Publisher",author:"Visual Desk",license:"Publisher media license",
    originalSource:"https://example.com/story",sourceAssetUrl:"https://media.example.com/ai-cover.jpg",
    rightsEvidenceUrl:"https://example.com/media-license",attribution:"Example Publisher",
    isAIGenerated:false,
    alt:{vi:"Ảnh trung tâm dữ liệu",en:"Data center image",es:"Imagen del centro de datos"},
    caption:{vi:"Ảnh do Example Publisher cung cấp.",en:"Image provided by Example Publisher.",
      es:"Imagen proporcionada por Example Publisher."}};
  assert.equal(validateVisualMetadata(cover,{slug:"story"}).legacy,false);
  assert.equal(verifyRasterBytes(bytes,cover).sha256,sha256);
  const changed=bytes.slice();changed[changed.length-1]^=1;
  assert.throws(()=>verifyRasterBytes(changed,cover),/VISUAL_HASH_MISMATCH/);
});

test("fetch gate rejects unverified rights and duplicate raster hashes before publication",async()=>{
  const bytes=jpeg1200x675();
  const candidate=extractPublisherVisualDisclosure(disclosureHtml(),"https://example.com/story");
  const fetchImpl=async()=>new Response(bytes,{status:200,headers:{"content-type":"image/jpeg","content-length":String(bytes.length)}});
  const first=await fetchVerifiedRasterAsset(candidate,{fetchImpl,priorArticles:[]});
  const cover=buildRasterCover(first,{slug:"story",verifiedAt:"2026-11-04T00:00:00.000Z"});
  assert.equal(cover.url,VISUAL_COVER_PREFIX+"story.jpg");
  assert.equal(cover.generated,false);
  await assert.rejects(fetchVerifiedRasterAsset({...candidate,rightsVerified:false},
    {fetchImpl,priorArticles:[]}),/VISUAL_RIGHTS_UNVERIFIED/);
  await assert.rejects(fetchVerifiedRasterAsset(candidate,{fetchImpl,
    priorArticles:[{cover:{sha256:first.sha256}}]}),/VISUAL_DUPLICATE_ASSET/);
});

test("candidate rights fail closed before any asset network request",async()=>{
  const candidate=extractPublisherVisualDisclosure(disclosureHtml(),"https://example.com/story");
  let fetchCalls=0;
  const fetchImpl=async()=>{fetchCalls++;throw Error("NETWORK_MUST_NOT_RUN");};
  await assert.rejects(fetchVerifiedRasterAsset({...candidate,rightsClass:"unknown"},
    {fetchImpl,priorArticles:[]}),/VISUAL_RIGHTS_CLASS_FORBIDDEN/);
  assert.equal(fetchCalls,0);
  assert.throws(()=>validateVisualCandidate({...candidate,rightsEvidenceUrl:"http://example.com/license"}),
    /VISUAL_RIGHTSEVIDENCEURL_INVALID/);
});

test("raster body is bounded while streaming even without Content-Length",async()=>{
  let cancelled=false;
  let released=false;
  const chunks=[new Uint8Array(4),new Uint8Array(5)];
  let index=0;
  const response={headers:{get:()=>null},body:{getReader:()=>({
    read:async()=>index<chunks.length?{done:false,value:chunks[index++]}:{done:true},
    cancel:async()=>{cancelled=true;},
    releaseLock:()=>{released=true;}
  })}};
  await assert.rejects(readBoundedRasterBody(response,8),/VISUAL_RESPONSE_TOO_LARGE/);
  assert.equal(cancelled,true);
  assert.equal(released,true);
});

test("raster body rejects declared oversize before reading stream",async()=>{
  let reads=0;
  const response={headers:{get:k=>k==="content-length"?"9":null},body:{getReader:()=>({
    read:async()=>{reads++;return {done:true};}
  })}};
  await assert.rejects(readBoundedRasterBody(response,8),/VISUAL_RESPONSE_TOO_LARGE/);
  assert.equal(reads,0);
});

test("new visual metadata rejects SVG, unknown rights, undersized/non-16:9 and missing locale metadata",()=>{
  const bytes=jpeg1200x675();
  const base={visualVersion:2,url:VISUAL_COVER_PREFIX+"story.jpg",mime:"image/jpeg",
    width:1200,height:675,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),
    generated:false,assetClass:"publisher-licensed-asset",rightsClass:"publisher-licensed",
    rightsVerified:true,owner:"Publisher",author:"Desk",license:"License",
    originalSource:"https://example.com/story",sourceAssetUrl:"https://example.com/a.jpg",
    rightsEvidenceUrl:"https://example.com/license",attribution:"Publisher",isAIGenerated:false,
    alt:{vi:"Mô tả hình ảnh",en:"Image description",es:"Descripción de imagen"},
    caption:{vi:"Ảnh do Publisher cung cấp.",en:"Image provided by Publisher.",
      es:"Imagen proporcionada por Publisher."}};
  assert.doesNotThrow(()=>validateVisualMetadata(base,{slug:"story"}));
  assert.throws(()=>validateVisualMetadata({...base,mime:"image/svg+xml"},{slug:"story"}),/MIME_UNSUPPORTED/);
  assert.throws(()=>validateVisualMetadata({...base,rightsClass:"unknown"},{slug:"story"}),/RIGHTS_CLASS_FORBIDDEN/);
  assert.throws(()=>validateVisualMetadata({...base,width:800},{slug:"story"}),/DIMENSIONS_INVALID/);
  assert.throws(()=>validateVisualMetadata({...base,alt:{en:"only english"}},{slug:"story"}),/LOCALE_METADATA_INVALID/);
});
