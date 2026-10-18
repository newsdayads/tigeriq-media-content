import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import {join} from "node:path";
import {parseFeed,providerConfig,modelJson,validateDraft,verifyReview,coverSvg,publish,commitContentJsonAtomically,createCoverExclusively} from "./hourly-publish.mjs";

const now=new Date("2026-10-18T03:00:00.000Z");
const date="Sat, 17 Oct 2026 23:00:00 GMT";
const feeds=[{id:"openai",url:"https://openai.com/news/rss.xml"},{id:"google",url:"https://blog.google/technology/ai/rss/"}];
const item=(url)=>"<rss><item><title>Two-source inference evaluation announcement</title><link>"+url+
 "</link><pubDate>"+date+"</pubDate><description>Official announcement evaluates technology results with caveats about methods and limitations.</description></item></rss>";
const officialTitle="Two-source inference evaluation announcement";
const officialExcerpt="Official announcement evaluates technology results with caveats about methods and limitations.";
const data=[
 {id:"openai-1",publisher:"openai",url:"https://openai.com/news/one",title:officialTitle,summary:officialExcerpt},
 {id:"google-1",publisher:"google",url:"https://blog.google/ai/two",title:officialTitle,summary:officialExcerpt}
];
const edition=lang=>({title:lang+" official AI technology evaluation findings",dek:"Summary with independently checked technology source evidence in "+lang,
 takeaways:["First verified evaluation and context","Independent official sources support this summary","Limitations and uncertainty are described"],
 sections:[1,2,3].map(n=>({heading:"Section "+n+" details",body:"Only source supported technology statements are included here, with limitations explicitly acknowledged and no invented facts."}))});
const draft={slug:"ai-inference-evaluation-2026",category:"Research",readTime:5,
 sourceIds:["openai-1","google-1"],
 claims:[{text:"Both official feeds discuss technology evaluation",sourceIds:["openai-1","google-1"]},
         {text:"Both official feeds discuss methodology and limitations",sourceIds:["google-1","openai-1"]}],
 editions:{vi:edition("vi"),en:edition("en"),es:edition("es")}};
const excerpts=(ids)=>ids.map(sourceId=>({sourceId,text:officialExcerpt}));
const review={pass:true,claimsSupported:true,localesValid:true,supportedSourceIds:["openai-1","google-1"],supportedClaims:[0,1],
 claimSourceEvidence:[{index:0,sourceIds:["openai-1","google-1"],excerpts:excerpts(["openai-1","google-1"])},
                      {index:1,sourceIds:["google-1","openai-1"],excerpts:excerpts(["google-1","openai-1"])}]};
const env={AI_CHAT_COMPLETIONS_URL:"https://example.org/v1/chat/completions",AI_API_KEY:"FAKE_TEST_TOKEN",
 WRITER_MODEL:"writer-model",REVIEWER_MODEL:"reviewer-model"};
function rssResponse(xml,url){ const response=new Response(xml,{status:200}); Object.defineProperty(response,"url",{value:url}); return response; }
function mockFetch({replyDraft=draft,replyReview=review,nonJson=false,modelPrompts=null}={}){
 let call=0;
 return async (url,options)=>{
   if(url===feeds[0].url)return rssResponse(item(data[0].url),url);
   if(url===feeds[1].url)return rssResponse(item(data[1].url),url);
   if(url===env.AI_CHAT_COMPLETIONS_URL){
     if(modelPrompts)modelPrompts.push(JSON.parse(options.body).messages[0].content);
     if(nonJson)return new Response("OK\n",{status:200,headers:{"content-type":"application/json"}});
     return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(call++===0?replyDraft:replyReview)}}]}),
       {status:200,headers:{"content-type":"application/json"}});
   }
   throw Error("Unexpected test URL");
 };
}
async function tmp(cb,store={articles:[]}){
 const root=await fs.mkdtemp(join(os.tmpdir(),"tigeriq-publish-test-"));
 await fs.writeFile(join(root,"content.json"),JSON.stringify(store));
 try{return await cb(root);}finally{await fs.rm(root,{recursive:true,force:true});}
}

test("RSS must contain recent dated HTTPS summary",()=>{
 assert.equal(parseFeed(item(data[0].url),"openai",now).length,1);
 assert.equal(parseFeed(item(data[0].url),"openai",new Date("2026-11-01T03:00:00Z")).length,0);
 assert.equal(parseFeed(item("http://unsafe.example/x"),"openai",now).length,0);
});
test("official publisher RSS cannot reclassify third-party links as independent official evidence",()=>{
 assert.equal(parseFeed(item("https://www.openai.com/news/article"),"openai",now).length,1);
 assert.equal(parseFeed(item("https://blog.google/ai/article"),"google",now).length,1);
 assert.equal(parseFeed(item("https://github.blog/changelog/article"),"github",now).length,1);
 assert.equal(parseFeed(item("https://engineering.fb.com/2026/example"),"meta",now).length,1);
 assert.equal(parseFeed(item("https://blogs.nvidia.com/blog/example"),"nvidia",now).length,1);
 assert.equal(parseFeed(item("https://outside.example.com/ai/article"),"openai",now).length,0);
 assert.equal(parseFeed(item("https://fakeopenai.com/news/article"),"openai",now).length,0);
 assert.equal(parseFeed(item("https://openai.com.evil.example/news/article"),"openai",now).length,0);
 assert.equal(parseFeed(item("https://openai.com/news/article"),"unknown-source",now).length,0);
});
test("retired GitHub Models, missing provider and reviewer reuse are blocked",()=>{
 assert.throws(()=>providerConfig({}),/AI_PROVIDER_NOT_CONFIGURED/);
 assert.throws(()=>providerConfig({...env,AI_CHAT_COMPLETIONS_URL:"https://models.github.ai/inference/chat/completions"}),/RETIRED/);
 assert.throws(()=>providerConfig({...env,REVIEWER_MODEL:env.WRITER_MODEL}),/INDEPENDENT/);
});
test("HTTP 200 plain OK is NOT a valid AI JSON response",async()=>{
 const provider=providerConfig(env);
 await assert.rejects(()=>modelJson({fetchImpl:mockFetch({nonJson:true}),provider,model:provider.writer,prompt:"test"}),/INVALID_JSON_ENVELOPE/);
});

test("AI provider rejects oversized declared JSON before reading response body",async()=>{
 let bodyReads=0;
 const fetchImpl=async()=>({
   ok:true,status:200,headers:{get:name=>name==="content-type"?"application/json":
      name==="content-length"?"2097152":null},
   text:async()=>{bodyReads++;return "{}";},
 });
 await assert.rejects(()=>modelJson({fetchImpl,provider:providerConfig(env),model:"writer-model",prompt:"test"}),
   /AI_PROVIDER_RESPONSE_TOO_LARGE/);
 assert.equal(bodyReads,0,"a declared oversized response must be stopped before JSON buffering");
});

test("AI provider streaming JSON has a strict byte budget and cancels oversized body",async()=>{
 let cancelled=false;
 const stream=new ReadableStream({
   pull(controller){controller.enqueue(new Uint8Array(150000));},
   cancel(){cancelled=true;}
 });
 const fetchImpl=async()=>new Response(stream,{status:200,headers:{"content-type":"application/json"}});
 await assert.rejects(()=>modelJson({fetchImpl,provider:providerConfig(env),model:"writer-model",prompt:"test"}),
   /AI_PROVIDER_RESPONSE_TOO_LARGE/);
 assert.equal(cancelled,true,"must terminate the provider stream after exceeding the byte budget");
});

test("writer must have 3 native locales and two independent verified sources",()=>{
 assert.equal(validateDraft(draft,data).length,2);
 assert.throws(()=>validateDraft({...draft,editions:{vi:edition("vi"),en:edition("en")}},data),/LOCALES_INCOMPLETE/);
 assert.throws(()=>validateDraft({...draft,sourceIds:["openai-1"]},data),/SOURCES_INSUFFICIENT/);
});
test("draft slug requires a primitive string, not a regex-coerced number or object",()=>{
 assert.throws(()=>validateDraft({...draft,slug:123},data),/DRAFT_SLUG_INVALID/);
 assert.throws(()=>validateDraft({...draft,slug:new String("valid-slug")},data),/DRAFT_SLUG_INVALID/);
 assert.doesNotThrow(()=>validateDraft(draft,data));
});

test("each factual claim must cite two different official publishers",()=>{
 const claimWithIds=ids=>({...draft,claims:[{...draft.claims[0],sourceIds:ids},draft.claims[1]]});
 assert.equal(validateDraft(draft,data).length,2);
 assert.throws(()=>validateDraft(claimWithIds(["openai-1"]),data),/DRAFT_CLAIMS_UNSUPPORTED/);
 assert.throws(()=>validateDraft(claimWithIds(["openai-1","openai-1"]),data),/DRAFT_CLAIMS_UNSUPPORTED/);
 assert.throws(()=>validateDraft(claimWithIds(["openai-1","missing-id"]),data),/DRAFT_CLAIMS_UNSUPPORTED/);
 const samePublisherItems=[...data,{id:"openai-2",publisher:"openai",url:"https://openai.com/news/other"}];
 const samePublisherDraft={...draft,sourceIds:["openai-1","openai-2","google-1"],
   claims:[{...draft.claims[0],sourceIds:["openai-1","openai-2"]},draft.claims[1]]};
 assert.throws(()=>validateDraft(samePublisherDraft,samePublisherItems),/DRAFT_CLAIMS_UNSUPPORTED/);
});

test("independent reviewer must attest all sources and claims",()=>{
 assert.doesNotThrow(()=>verifyReview(review,draft,data));
 assert.throws(()=>verifyReview({...review,pass:false},draft,data),/REVIEW_REJECTED/);
 assert.throws(()=>verifyReview({...review,supportedClaims:[0]},draft,data),/REVIEW_CLAIMS_UNVERIFIED/);
 assert.throws(()=>verifyReview({...review,claimSourceEvidence:undefined},draft,data),/REVIEW_PER_CLAIM_EVIDENCE_MISSING/);
 assert.throws(()=>verifyReview({...review,claimSourceEvidence:[review.claimSourceEvidence[0],review.claimSourceEvidence[0]]},draft,data),/REVIEW_PER_CLAIM_EVIDENCE_MISSING/);
 assert.throws(()=>verifyReview({...review,claimSourceEvidence:[{index:0,sourceIds:["openai-1"]},review.claimSourceEvidence[1]]},draft,data),/REVIEW_PER_CLAIM_SOURCES_UNVERIFIED/);
 assert.throws(()=>verifyReview({...review,claimSourceEvidence:[{index:0,sourceIds:["openai-1","openai-1"]},review.claimSourceEvidence[1]]},draft,data),/REVIEW_PER_CLAIM_SOURCES_UNVERIFIED/);
 assert.throws(()=>verifyReview({...review,claimSourceEvidence:[{index:0,sourceIds:["openai-1","other"]},review.claimSourceEvidence[1]]},draft,data),/REVIEW_PER_CLAIM_SOURCES_UNVERIFIED/);
});
test("reviewer excerpt provenance matches each official feed, not only its source ID",()=>{
 const swap=evidence=>({...review,claimSourceEvidence:[evidence,review.claimSourceEvidence[1]]});
 const base=review.claimSourceEvidence[0];
 assert.doesNotThrow(()=>verifyReview(review,draft,data));
 const whitespaceVariant=[{...data[0],summary:officialExcerpt.replace("Official announcement","Official   announcement")},data[1]];
 assert.doesNotThrow(()=>verifyReview(review,draft,whitespaceVariant),"normalized whitespace in official excerpts");
 assert.throws(()=>verifyReview(swap({...base,excerpts:[]}),draft,data),/REVIEW_EXCERPTS_UNVERIFIED/);
 assert.throws(()=>verifyReview(swap({...base,excerpts:excerpts(["openai-1","openai-1"])}),draft,data),/REVIEW_EXCERPTS_UNVERIFIED/);
 assert.throws(()=>verifyReview(swap({...base,excerpts:[{sourceId:"openai-1",text:"Invented article claim not present in the source summary"},{sourceId:"google-1",text:officialExcerpt}]}),draft,data),/REVIEW_EXCERPTS_UNVERIFIED/);
 assert.throws(()=>verifyReview(swap({...base,excerpts:[{sourceId:"openai-1",text:"too short"},{sourceId:"google-1",text:officialExcerpt}]}),draft,data),/REVIEW_EXCERPTS_UNVERIFIED/);
 assert.throws(()=>verifyReview(swap({...base,excerpts:[{sourceId:"openai-1",text:officialExcerpt},{sourceId:"google-1",text:undefined}]}),draft,data),/REVIEW_EXCERPTS_UNVERIFIED/);
 const crossPublisherSources=[data[0],{...data[1],title:"Completely unrelated source headline",summary:"Separate research that does not corroborate the claim being reviewed."}];
 assert.throws(()=>verifyReview(review,draft,crossPublisherSources),/REVIEW_EXCERPTS_UNVERIFIED/);
});
test("copyright-safe SVG escapes untrusted title",()=>{
 const svg=coverSvg("<unsafe>&news");
 assert.match(svg,/width="1200" height="675"/);
 assert.match(svg,/&lt;unsafe&gt;&amp;news/);
 assert.ok(!svg.includes("<unsafe>"));
});
test("untrusted AI title cannot put XML-forbidden control characters in original SVG",()=>{
 const svg=coverSvg("AI\u0000 updates\u0001 with\u000b rights\u001f\uFFFE\uFFFF");
 assert.doesNotMatch(svg,/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u,
   "XML 1.0 forbids NUL and non-whitespace C0 controls in character data");
 assert.match(svg,/AI updates with rights/,"safe visible title content remains intact");
});

test("generated SVG terminates as valid XML, without escaped newline bytes after root",()=>{
 const svg=coverSvg("Original news cover");
 assert.match(svg, /<\/svg>\n$/, "a literal backslash-n after the XML root corrupts SVG");
 assert.doesNotMatch(svg, /<\/svg>\\n$/, "SVG must not contain a literal escaped newline after root");
});

test("isolated full workflow stages 3 languages and a rights-tagged cover",()=>tmp(async root=>{
 const result=await publish({root,fetchImpl:mockFetch(),env,now,feeds});
 assert.equal(result.status,"staged");
 const store=JSON.parse(await fs.readFile(join(root,"content.json"),"utf8"));
 assert.equal(store.articles.length,1);
 assert.deepEqual(Object.keys(store.articles[0].editions).sort(),["en","es","vi"]);
 assert.match(store.articles[0].cover.rights,/Original TigerIQ/);
 assert.equal(store.articles[0].verification.evidence.length,2);
 assert.match(await fs.readFile(join(root,"covers",result.slug+".svg"),"utf8"),/TIGERIQ/);
}));
test("duplicate is NOOP, not a duplicate publication",()=>tmp(async root=>{
 await publish({root,fetchImpl:mockFetch(),env,now,feeds});
 const again=await publish({root,fetchImpl:mockFetch(),env,now,feeds});
 assert.equal(again.status,"noop");
 assert.equal(JSON.parse(await fs.readFile(join(root,"content.json"),"utf8")).articles.length,1);
}));
test("review failure and bad AI envelope preserve content",()=>tmp(async root=>{
 const before=await fs.readFile(join(root,"content.json"),"utf8");
 await assert.rejects(()=>publish({root,fetchImpl:mockFetch({replyReview:{...review,pass:false}}),env,now,feeds}),/REVIEW_REJECTED/);
 await assert.rejects(()=>publish({root,fetchImpl:mockFetch({nonJson:true}),env,now,feeds}),/INVALID_JSON_ENVELOPE/);
 assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
 assert.deepEqual(await fs.readdir(root),["content.json"]);
}));
test("AI writer and reviewer prompts require two-source claim evidence",()=>tmp(async root=>{
 const modelPrompts=[];
 const result=await publish({root,fetchImpl:mockFetch({modelPrompts}),env,now,feeds});
 assert.equal(result.status,"staged");
 assert.equal(modelPrompts.length,2);
 assert.match(modelPrompts[0],/claims:\[\{text,sourceIds:\[idA,idB\]\}\]/);
 assert.match(modelPrompts[1],/claimSourceEvidence/);
 assert.match(modelPrompts[1],/For EACH claim index/);
}));
test("large official RSS collection has a bounded and publisher-diverse AI prompt packet",()=>tmp(async root=>{
 const verbose=source=>"<rss>"+Array.from({length:18},(_,i)=>
   "<item><title>Official AI evaluation announcement "+source+" "+i+"</title>"
   +"<link>"+(source==="openai"?"https://openai.com/news/":"https://blog.google/ai/")+i+"</link>"
   +"<pubDate>"+date+"</pubDate>"
   +"<description>"+("Official technical release evidence and methods. ").repeat(28)+"</description>"
   +"</item>").join("")+"</rss>";
 const captured=[];
 const boundedFetch=async(url,options)=>{
   if(url===feeds[0].url)return rssResponse(verbose("openai"),url);
   if(url===feeds[1].url)return rssResponse(verbose("google"),url);
   if(url===env.AI_CHAT_COMPLETIONS_URL){
     captured.push(JSON.parse(options.body).messages[0].content);
     return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({noQualifiedStory:true})}}]}),
       {status:200,headers:{"content-type":"application/json"}});
   }
   throw Error("Unexpected test URL");
 };
 const result=await publish({root,fetchImpl:boundedFetch,env,now,feeds});
 assert.equal(result.status,"noop");
 assert.equal(captured.length,1);
 const packet=JSON.parse(captured[0].split(" PACKET=").at(-1));
 assert.ok(JSON.stringify(packet).length<=12000,"source packet must have a deterministic 12k-char upper bound");
 assert.ok(new Set(packet.map(x=>x.publisher)).size>=2,"packet must retain independent publishers");
 assert.ok(captured[0].length<15000,"provider request must not contain an uncontrolled full-feed dump");
}));

test("missing provider blocks before any external request",()=>tmp(async root=>{
 await assert.rejects(()=>publish({root,fetchImpl:()=>{throw Error("must not request")},env:{},now,feeds}),/AI_PROVIDER_NOT_CONFIGURED/);
}));

test("RSS redirect to unauthorized host cannot impersonate official feed evidence",()=>tmp(async root=>{
 const baseFetch=mockFetch();
 const before=await fs.readFile(join(root,"content.json"),"utf8");
 const divertedFetch=async (url,options)=>{
   if(url===feeds[0].url)return rssResponse(item(data[0].url),"https://untrusted-news.example/rss");
   return baseFetch(url,options);
 };
 const result=await publish({root,fetchImpl:divertedFetch,env,now,feeds});
 assert.equal(result.status,"noop","off-domain RSS redirect must not count as official publisher evidence");
 assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
 assert.deepEqual(await fs.readdir(root),["content.json"]);
}));

test("RSS fetch refuses a disallowed initial host before any network request",()=>tmp(async root=>{
  const attempted=[];
  const otherFeed=feeds[1];
  const forged={id:"openai",url:"http://127.0.0.1:8795/private"};
  const baseFetch=mockFetch();
  const guardedFetch=async (url,options)=>{
    attempted.push(url);
    if(url===forged.url)throw Error("PRIVATE_HOST_WAS_REQUESTED");
    return baseFetch(url,options);
  };
  const result=await publish({root,fetchImpl:guardedFetch,env,now,feeds:[forged,otherFeed]});
  assert.equal(result.status,"noop");
  assert.deepEqual(attempted,[otherFeed.url],"unapproved host must not even receive a request");
}));

test("RSS HTTP redirect never auto-follows an unapproved host",()=>tmp(async root=>{
  const calls=[];
  const baseFetch=mockFetch();
  const guardedFetch=async (url,options)=>{
    calls.push({url,redirect:options?.redirect});
    if(url===feeds[0].url)return new Response(null,{status:302,
      headers:{location:"http://127.0.0.1:8795/private"}});
    return baseFetch(url,options);
  };
  const result=await publish({root,fetchImpl:guardedFetch,env,now,feeds});
  assert.equal(result.status,"noop");
  assert.deepEqual(calls.map(c=>c.url),[feeds[0].url,feeds[1].url]);
  assert.ok(calls.every(c=>c.redirect==="manual"),
    "native fetch must never follow a redirect before the allowlist gate");
}));

test("RSS same-publisher HTTPS redirect is explicitly followed",()=>tmp(async root=>{
  const calls=[];
  const baseFetch=mockFetch();
  const destination="https://blog.google/innovation-and-ai/technology/ai/rss/";
  const redirectedFetch=async (url,options)=>{
    calls.push({url,redirect:options?.redirect});
    if(url===feeds[1].url)return new Response(null,{status:301,
      headers:{location:"/innovation-and-ai/technology/ai/rss/"}});
    if(url===destination)return rssResponse(item(data[1].url),destination);
    return baseFetch(url,options);
  };
  const result=await publish({root,fetchImpl:redirectedFetch,env,now,feeds});
  assert.equal(result.status,"staged","same-publisher redirect must preserve legitimate RSS");
  const rssCalls=calls.filter(c=>c.url!==env.AI_CHAT_COMPLETIONS_URL);
  assert.deepEqual(rssCalls.map(c=>c.url),[feeds[0].url,feeds[1].url,destination]);
  assert.ok(rssCalls.every(c=>c.redirect==="manual"),
    "RSS fetch must use manual redirects; model API calls are a separate surface");
}));

test("content.json staged write failure preserves canonical bytes and removes partial tempfile",async()=>{
 const canonical="/tmp/news/content.json",files=new Map([[canonical,"PREVIOUS_VALID_JSON"]]),ops=[];
 const io={
  open:async(p,mode)=>{
   assert.equal(mode,"wx");assert.notEqual(p,canonical);
   ops.push("open");files.set(p,"PARTIAL");
   return {writeFile:async()=>{ops.push("write");throw Error("SIMULATED_DISK_FULL");},
           close:async()=>{ops.push("close");}};
  },
  rename:async()=>{throw Error("RENAME_MUST_NOT_RUN");},
  unlink:async p=>{ops.push("unlink");files.delete(p);}
 };
 await assert.rejects(()=>commitContentJsonAtomically(canonical,"NEXT_JSON",io),/SIMULATED_DISK_FULL/);
 assert.equal(files.get(canonical),"PREVIOUS_VALID_JSON");
 assert.deepEqual([...files.keys()],[canonical]);
 assert.deepEqual(ops,["open","write","close","unlink"]);
});
test("content.json failed atomic rename preserves previous file and cleans tempfile",async()=>{
 const canonical="/tmp/news/content.json",files=new Map([[canonical,"PREVIOUS_VALID_JSON"]]),ops=[];
 const io={
  open:async(p,mode)=>{
   assert.equal(mode,"wx");assert.notEqual(p,canonical);
   files.set(p,"");return {writeFile:async data=>{files.set(p,data);},close:async()=>{}};
  },
  rename:async()=>{ops.push("rename");throw Error("SIMULATED_RENAME_DENIED");},
  unlink:async p=>{ops.push("unlink");files.delete(p);}
 };
 await assert.rejects(()=>commitContentJsonAtomically(canonical,"NEXT_JSON",io),/SIMULATED_RENAME_DENIED/);
 assert.equal(files.get(canonical),"PREVIOUS_VALID_JSON");
 assert.deepEqual([...files.keys()],[canonical]);
 assert.deepEqual(ops,["rename","unlink"]);
});
test("content.json switches only at rename after successful staged write",async()=>{
 const canonical="/tmp/news/content.json",files=new Map([[canonical,"PREVIOUS_VALID_JSON"]]),ops=[];
 const io={
  open:async(p,mode)=>{
   assert.equal(mode,"wx");assert.notEqual(p,canonical);
   files.set(p,"");ops.push("open");
   return {writeFile:async data=>{assert.equal(files.get(canonical),"PREVIOUS_VALID_JSON");files.set(p,data);ops.push("write");},
           close:async()=>{ops.push("close");}};
  },
  rename:async(from,to)=>{assert.equal(to,canonical);assert.equal(files.get(canonical),"PREVIOUS_VALID_JSON");files.set(to,files.get(from));files.delete(from);ops.push("rename");},
  unlink:async()=>{throw Error("UNLINK_NOT_EXPECTED");}
 };
 await commitContentJsonAtomically(canonical,"NEXT_JSON",io);
 assert.equal(files.get(canonical),"NEXT_JSON");
 assert.deepEqual([...files.keys()],[canonical]);
 assert.deepEqual(ops,["open","write","close","rename"]);
});

test("interrupted SVG cover write cleans only its own new partial file",async()=>{
 const path="/tmp/news/covers/story.svg",files=new Map(),ops=[];
 const io={
   open:async(p,flag)=>{
     assert.equal(p,path);assert.equal(flag,"wx");files.set(path,"PARTIAL_SVG");ops.push("open");
     return {
       writeFile:async()=>{ops.push("write");throw Error("SIMULATED_COVER_DISK_FULL");},
       close:async()=>{ops.push("close");},
     };
   },
   unlink:async(p)=>{assert.equal(p,path);ops.push("unlink");files.delete(p);}
 };
 await assert.rejects(()=>createCoverExclusively(path,"FULL_SVG",io),/SIMULATED_COVER_DISK_FULL/);
 assert.equal(files.has(path),false,"no orphan cover may block a subsequent story attempt");
 assert.deepEqual(ops,["open","write","close","unlink"]);
});

test("existing SVG cover is never unlinked if exclusive creation fails",async()=>{
 const path="/tmp/news/covers/story.svg",files=new Map([[path,"EXISTING_SVG"]]),ops=[];
 const io={
   open:async()=>{ops.push("open");const err=Error("file exists");err.code="EEXIST";throw err;},
   unlink:async()=>{ops.push("BAD_UNLINK");files.delete(path);}
 };
 await assert.rejects(()=>createCoverExclusively(path,"NEXT_SVG",io),{code:"EEXIST"});
 assert.equal(files.get(path),"EXISTING_SVG");
 assert.deepEqual(ops,["open"]);
});

test("successful SVG cover creation commits complete bytes without cleanup",async()=>{
 const path="/tmp/news/covers/story.svg",files=new Map(),ops=[];
 const io={
   open:async(p,flag)=>{
     assert.equal(flag,"wx");files.set(p,"");ops.push("open");
     return {
       writeFile:async(data,encoding)=>{assert.equal(encoding,"utf8");files.set(p,data);ops.push("write");},
       close:async()=>{ops.push("close");}
     };
   },
   unlink:async()=>{ops.push("BAD_UNLINK");}
 };
 await createCoverExclusively(path,"<svg>valid</svg>",io);
 assert.equal(files.get(path),"<svg>valid</svg>");
 assert.deepEqual(ops,["open","write","close"]);
});
