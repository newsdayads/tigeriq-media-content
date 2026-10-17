import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import {join} from "node:path";
import {parseFeed,providerConfig,modelJson,validateDraft,verifyReview,coverSvg,publish} from "./hourly-publish.mjs";

const now=new Date("2026-10-18T03:00:00.000Z");
const date="Sat, 17 Oct 2026 23:00:00 GMT";
const feeds=[{id:"openai",url:"https://example.org/a"},{id:"google",url:"https://example.org/b"}];
const item=(url)=>"<rss><item><title>Two-source inference evaluation announcement</title><link>"+url+
 "</link><pubDate>"+date+"</pubDate><description>Official announcement evaluates technology results with caveats about methods and limitations.</description></item></rss>";
const data=[
 {id:"openai-1",publisher:"openai",url:"https://openai.com/news/one"},
 {id:"google-1",publisher:"google",url:"https://blog.google/ai/two"}
];
const edition=lang=>({title:lang+" official AI technology evaluation findings",dek:"Summary with independently checked technology source evidence in "+lang,
 takeaways:["First verified evaluation and context","Independent official sources support this summary","Limitations and uncertainty are described"],
 sections:[1,2,3].map(n=>({heading:"Section "+n+" details",body:"Only source supported technology statements are included here, with limitations explicitly acknowledged and no invented facts."}))});
const draft={slug:"ai-inference-evaluation-2026",category:"Research",readTime:5,
 sourceIds:["openai-1","google-1"],
 claims:[{text:"Both official feeds discuss technology evaluation",sourceIds:["openai-1","google-1"]},
         {text:"Both official feeds discuss methodology and limitations",sourceIds:["google-1","openai-1"]}],
 editions:{vi:edition("vi"),en:edition("en"),es:edition("es")}};
const review={pass:true,claimsSupported:true,localesValid:true,supportedSourceIds:["openai-1","google-1"],supportedClaims:[0,1]};
const env={AI_CHAT_COMPLETIONS_URL:"https://example.org/v1/chat/completions",AI_API_KEY:"FAKE_TEST_TOKEN",
 WRITER_MODEL:"writer-model",REVIEWER_MODEL:"reviewer-model"};
function mockFetch({replyDraft=draft,replyReview=review,nonJson=false}={}){
 let call=0;
 return async url=>{
   if(url===feeds[0].url)return new Response(item(data[0].url),{status:200});
   if(url===feeds[1].url)return new Response(item(data[1].url),{status:200});
   if(url===env.AI_CHAT_COMPLETIONS_URL){
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
test("retired GitHub Models, missing provider and reviewer reuse are blocked",()=>{
 assert.throws(()=>providerConfig({}),/AI_PROVIDER_NOT_CONFIGURED/);
 assert.throws(()=>providerConfig({...env,AI_CHAT_COMPLETIONS_URL:"https://models.github.ai/inference/chat/completions"}),/RETIRED/);
 assert.throws(()=>providerConfig({...env,REVIEWER_MODEL:env.WRITER_MODEL}),/INDEPENDENT/);
});
test("HTTP 200 plain OK is NOT a valid AI JSON response",async()=>{
 const provider=providerConfig(env);
 await assert.rejects(()=>modelJson({fetchImpl:mockFetch({nonJson:true}),provider,model:provider.writer,prompt:"test"}),/INVALID_JSON_ENVELOPE/);
});
test("writer must have 3 native locales and two independent verified sources",()=>{
 assert.equal(validateDraft(draft,data).length,2);
 assert.throws(()=>validateDraft({...draft,editions:{vi:edition("vi"),en:edition("en")}},data),/LOCALES_INCOMPLETE/);
 assert.throws(()=>validateDraft({...draft,sourceIds:["openai-1"]},data),/SOURCES_INSUFFICIENT/);
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
});
test("copyright-safe SVG escapes untrusted title",()=>{
 const svg=coverSvg("<unsafe>&news");
 assert.match(svg,/width="1200" height="675"/);
 assert.match(svg,/&lt;unsafe&gt;&amp;news/);
 assert.ok(!svg.includes("<unsafe>"));
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
test("missing provider blocks before any external request",()=>tmp(async root=>{
 await assert.rejects(()=>publish({root,fetchImpl:()=>{throw Error("must not request")},env:{},now,feeds}),/AI_PROVIDER_NOT_CONFIGURED/);
}));
