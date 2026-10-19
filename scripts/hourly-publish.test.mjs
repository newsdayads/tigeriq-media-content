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

test("RSS metadata fields inside quoted CDATA must never spoof title or freshness",()=>{
 const officialTitle="Actual official publication with reproducible AI evaluation findings";
 const summary='<description><![CDATA[Official paper reports reproducible testing methods and relevant caveats. '+
   'Example XML: <title>Fabricated spectacular AI result</title>'+
   '<pubDate>'+date+'</pubDate> are literal quoted text only.]]></description>';
 const rss=(timestamp,titleMarkup='<title>'+officialTitle+'</title>')=>
   '<rss><item>'+summary+titleMarkup+
   '<link>https://openai.com/news/real-research-publication</link>'+
   '<pubDate>'+timestamp+'</pubDate></item></rss>';
 const expired=parseFeed(rss("Fri, 09 Oct 2026 23:00:00 GMT"),"openai",now);
 assert.equal(expired.length,0,
   "CDATA pseudo pubDate cannot refresh an expired original article");
 const fresh=parseFeed(rss(date),"openai",now);
 assert.equal(fresh.length,1);
 assert.equal(fresh[0].title,officialTitle,
   "CDATA pseudo title cannot override the real RSS title");
 assert.equal(fresh[0].publishedAt,new Date(date).toISOString());
 const legalCdataTitle='<title><![CDATA['+officialTitle+']]></title>';
 const legal=parseFeed(rss(date,legalCdataTitle),"openai",now);
 assert.equal(legal.length,1);
 assert.equal(legal[0].title,officialTitle,
   "genuine CDATA title remains visible after metadata masking");
});

test("RSS must contain recent dated HTTPS summary",()=>{
 assert.equal(parseFeed(item(data[0].url),"openai",now).length,1);
 assert.equal(parseFeed(item(data[0].url),"openai",new Date("2026-11-01T03:00:00Z")).length,0);
 assert.equal(parseFeed(item("http://unsafe.example/x"),"openai",now).length,0);
});
test("XML-commented RSS and Atom items must never become official article evidence",()=>{
 const legitimate=item(data[0].url);
 const commented=legitimate.replace("<rss>","<rss><!--").replace("</rss>","--></rss>");
 assert.equal(parseFeed(commented,"openai",now).length,0,
   "an RSS item enclosed in an XML comment is not published evidence");
 const mixed=commented.replace("--></rss>","-->")+legitimate.replace("<rss>","");
 const actual=parseFeed(mixed,"openai",now);
 assert.equal(actual.length,1,"only the real item after an XML comment should remain");
 assert.equal(actual[0].id,"openai-1","commented entries must not shift canonical source IDs");
 const atom='<feed><!--<entry><title>Fake official AI announcement from Google</title>'+
   '<updated>2026-10-17T23:00:00Z</updated>'+
   '<summary>Fake evaluation details deliberately hidden inside an XML comment.</summary>'+
   '<link rel="alternate" href="https://blog.google/ai/two"/></entry>--></feed>';
 assert.equal(parseFeed(atom,"google",now).length,0,
   "a commented-out Atom entry must not be accepted as official evidence");
});

test("RSS and Atom CDATA must not create phantom official article entries",()=>{
 const fakeRss='<item><title>Fictional model breakthrough announced today</title>'+
   '<link>https://openai.com/news/fictional-cdata-phantom</link>'+
   '<pubDate>'+date+'</pubDate>'+
   '<description>This is a fake official announcement embedded as unparsed text, not a story.</description></item>';
 const outer='<rss><channel><description><![CDATA['+fakeRss+']]></description>'+
   item(data[0].url).replace('<rss>','').replace('</rss>','')+'</channel></rss>';
 const observed=parseFeed(outer,"openai",now);
 assert.equal(observed.length,1,"a literal item tag inside feed CDATA is not a published article");
 assert.equal(observed[0].url,data[0].url,"the sole visible story is the real RSS item");
 assert.equal(observed[0].id,"openai-1","CDATA must not shift official source identity");
 const fakeAtom='<entry><title>Fictional cross-source validation</title>'+
   '<link rel="alternate" href="https://blog.google/ai/phantom-cdata"/>'+
   '<updated>2026-10-17T23:00:00Z</updated>'+
   '<summary>Fake report nested in feed CDATA, not a published news story.</summary></entry>';
 const atom='<feed><subtitle><![CDATA['+fakeAtom+']]></subtitle></feed>';
 assert.equal(parseFeed(atom,"google",now).length,0,
   "a literal Atom entry inside CDATA is not published evidence");
});

test("CDATA markers in a genuine RSS title must remain literal, not inject hidden content",()=>{
 const marker="__TIGERIQ_CDATA_0__";
 const expectedTitle="Official AI "+marker+" evaluation announcement";
 const xml="<rss><item><title>"+expectedTitle+"</title>"+
   "<link>https://openai.com/news/marker-test</link><pubDate>"+date+"</pubDate>"+
   "<description><![CDATA[Documented evaluation with methods, caveats and limitations from the official publisher.]]></description>"+
   "</item></rss>";
 const articles=parseFeed(xml,"openai",now);
 assert.equal(articles.length,1,"the legitimate article remains eligible");
 assert.equal(articles[0].title,expectedTitle,
   "literal title data must not be replaced by an internal CDATA placeholder");
 assert.equal(articles[0].summary,
   "Documented evaluation with methods, caveats and limitations from the official publisher.");
 assert.equal(articles[0].url,"https://openai.com/news/marker-test");
});

test("RSS content:encoded provides recent official evidence when description is missing",()=>{
 const xml='<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>'+
   '<title>Official AI evaluation findings from the publisher</title>'+
   '<link>https://openai.com/news/ai-evaluation</link>'+
   '<pubDate>'+date+'</pubDate>'+
   '<content:encoded><![CDATA[<p>Official AI evaluation reports new results, replicable methods, and clearly documented limitations.</p>]]></content:encoded>'+
   '</item></channel></rss>';
 const stories=parseFeed(xml,"openai",now);
 assert.equal(stories.length,1,"a valid official content:encoded RSS item must not be discarded");
 assert.match(stories[0].summary,/replicable methods, and clearly documented limitations/);
 assert.equal(stories[0].url,"https://openai.com/news/ai-evaluation");
});

test("fresh official RSS item after twenty stale items is still discoverable",()=>{
 const staleItems=Array.from({length:20},(_,i)=>
   "<item><title>Old official archive item "+i+"</title>"+
   "<link>https://openai.com/news/archive-"+i+"</link>"+
   "<pubDate>Tue, 01 Sep 2026 12:00:00 GMT</pubDate>"+
   "<description>Historical official AI archive source, outside the recent freshness window.</description></item>").join("");
 const fresh="<item><title>Current official AI safety report</title>"+
   "<link>https://openai.com/news/current-report</link>"+
   "<pubDate>"+date+"</pubDate>"+
   "<description>Recent official AI report with detailed methods, findings and limitations.</description></item>";
 const articles=parseFeed("<rss>"+staleItems+fresh+"</rss>","openai",now);
 assert.equal(articles.length,1,"discard expired entries before applying a cap of 20 accepted news items");
 assert.equal(articles[0].url,"https://openai.com/news/current-report");
});

test("freshest official article after twenty still-valid older entries must be included",()=>{
 const olderDate="Sat, 17 Oct 2026 04:00:00 GMT";
 const previous=Array.from({length:20},(_,i)=>
   "<item><title>Previous official AI research bulletin "+i+"</title>"+
   "<link>https://openai.com/news/earlier-"+i+"</link>"+
   "<pubDate>"+olderDate+"</pubDate>"+
   "<description>Earlier verified AI engineering report with methods and measurable results.</description></item>").join("");
 const latest="<item><title>Newest official AI research breakthrough</title>"+
   "<link>https://openai.com/news/latest-breakthrough</link>"+
   "<pubDate>"+date+"</pubDate>"+
   "<description>Newest official AI research report containing evaluation results and limitations.</description></item>";
 const parsed=parseFeed("<rss>"+previous+latest+"</rss>","openai",now);
 assert.equal(parsed.length,20,"bound AI source packet to 20 articles per publisher");
 assert.equal(parsed[0]?.url,"https://openai.com/news/latest-breakthrough",
   "newest valid official article must be considered even when the feed is not date sorted");
 assert.equal(parsed.some(a=>a.url==="https://openai.com/news/latest-breakthrough"),true);
});

test("Atom content-only official entry provides evidence when summary is omitted",()=>{
 const entry='<feed><entry><title>Official AI research update with detailed findings</title>'+
   '<link rel="alternate" type="text/html" href="https://blog.google/ai/research-report"/>'+
   '<updated>2026-10-17T23:00:00Z</updated>'+
   '<content type="html">Official research report documents evaluation methods, verifiable evidence and key limitations.</content>'+
   '</entry></feed>';
 const found=parseFeed(entry,"google",now);
 assert.equal(found.length,1,"Atom permits a content element without a summary element");
 assert.match(found[0].summary,/verifiable evidence and key limitations/);
});

test("Atom entry must choose rel alternate article link and decode XML ampersands",()=>{
 const entry='<feed><entry><title>Official AI model evaluation report</title>'+
   '<link rel="self" href="https://blog.google/feeds/posts/default/991"/>'+
   '<link type="text/html" rel="alternate" href="https://blog.google/ai/story?topic=ai&amp;source=feed"/>'+
   '<updated>2026-10-17T23:00:00Z</updated>'+
   '<summary>Official results with methodology, evidence and limitations for this AI evaluation.</summary>'+
   '</entry></feed>';
 const found=parseFeed(entry,"google",now);
 assert.equal(found.length,1,"valid Atom entry with official article");
 assert.equal(found[0].url,"https://blog.google/ai/story?topic=ai&source=feed",
   "Atom rel=self is a feed identifier, not an article; XML ampersands must be decoded");
});

test("RSS link tags quoted inside item CDATA cannot masquerade as article permalinks",()=>{
 const head='<rss><item><title>Official AI evaluation and testing methodology</title>'+
   '<pubDate>'+date+'</pubDate>';
 const fake='<link>https://openai.com/news/phantom-link-from-cdata</link>';
 const quoted='<description><![CDATA[Real publisher research notes include methods and a quoted XML example '+
   fake+' which must never be treated as an actual RSS article permalink.]]></description>';
 const onlyQuoted=parseFeed(head+quoted+'</item></rss>',"openai",now);
 assert.equal(onlyQuoted.length,0,
   "RSS entry with no actual link must not use a quoted <link> inside CDATA");
 const real='<link>https://openai.com/news/verified-rss-permalink</link>';
 const withReal=parseFeed(head+quoted+real+'</item></rss>',"openai",now);
 assert.equal(withReal.length,1);
 assert.equal(withReal[0].url,"https://openai.com/news/verified-rss-permalink",
   "real permalink must outrank fake quoted CDATA link");
 const realCdata='<link><![CDATA[https://openai.com/news/legitimate-cdata-link]]></link>';
 const withCdataUrl=parseFeed(head+quoted+realCdata+'</item></rss>',"openai",now);
 assert.equal(withCdataUrl.length,1);
 assert.equal(withCdataUrl[0].url,"https://openai.com/news/legitimate-cdata-link",
   "preserve legal CDATA text within a genuine RSS link element");
});

test("Atom links quoted inside CDATA cannot become article URLs",()=>{
 const start='<feed><entry><title>Official AI evaluation with detailed methods</title>'+
   '<updated>2026-10-17T23:00:00Z</updated>';
 const fake='<link rel="alternate" type="text/html" href="https://blog.google/ai/phantom-cdata-link"/>';
 const quoted='<summary><![CDATA[Official findings include reproducible methods and an example of quoted XML '+
   fake+' which is documentation text, not a source article URL.]]></summary>';
 const self='<link rel="self" href="https://blog.google/feed/self"/>';
 const onlyMetadata=parseFeed(start+quoted+self+'</entry></feed>',"google",now);
 assert.equal(onlyMetadata.length,0,
   "CDATA content cannot turn a self-only Atom entry into an article");
 const real='<link rel="alternate" type="text/html" href="https://blog.google/ai/verified-real-article"/>';
 const realArticle=parseFeed(start+quoted+self+real+'</entry></feed>',"google",now);
 assert.equal(realArticle.length,1);
 assert.equal(realArticle[0].url,"https://blog.google/ai/verified-real-article",
   "CDATA fake link must not override the genuine Atom alternate permalink");
});

test("Atom enclosure and related links cannot impersonate official article evidence",()=>{
 const start='<feed><entry><title>Official AI evaluation reference</title>'+
   '<updated>2026-10-17T23:00:00Z</updated>'+
   '<summary>Official evaluation report examines measurable findings and limitations of new AI systems.</summary>';
 const enclosure=start+
   '<link rel="enclosure" type="audio/mpeg" href="https://blog.google/media/research-podcast.mp3"/>'+
   '<link rel="related" href="https://blog.google/related-material"/></entry></feed>';
 assert.equal(parseFeed(enclosure,"google",now).length,0,
   "Atom enclosure/related metadata is not a published article permalink");
 const defaultArticle=start+
   '<link type="text/html" href="https://blog.google/ai/research-article"/></entry></feed>';
 assert.equal(parseFeed(defaultArticle,"google",now)[0]?.url,
   "https://blog.google/ai/research-article",
   "an unqualified Atom link remains a valid alternate article URL");
});

test("Atom alternate XML feed must not supersede actual HTML article permalink",()=>{
 const prefix='<feed><entry><title>Official research report on AI evaluation methods</title>'+
   '<updated>2026-10-17T23:00:00Z</updated>'+
   '<summary>Official report summarizes reproducible AI research evaluation evidence and its technical limitations.</summary>';
 const xml='<link rel="alternate" type="application/atom+xml" href="https://blog.google/feeds/ai.xml"/>';
 const html='<link rel="alternate" type="text/html" href="https://blog.google/ai/research-breakthrough"/>';
 const entries=parseFeed(prefix+xml+html+'</entry></feed>',"google",now);
 assert.equal(entries.length,1);
 assert.equal(entries[0].url,"https://blog.google/ai/research-breakthrough",
   "XML feed is metadata, while text/html alternate is the article permalink");
 assert.equal(parseFeed(prefix+xml+'</entry></feed>',"google",now).length,0,
   "an XML-only alternate is not a readable news article permalink");
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

test("AI POST refuses an off-origin HTTP redirect before forwarding sensitive prompts",async()=>{
 let forwarded=0;
 const intercepted=async (_url,options)=>{
   // Native fetch follows a 307/308 POST by default, including the JSON body.
   // A strict redirect policy makes the transport fail closed instead.
   if(options.redirect==="error")throw Error("SIMULATED_UNTRUSTED_307_BLOCKED");
   forwarded++;
   return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}),
     {status:200,headers:{"content-type":"application/json"}});
 };
 await assert.rejects(()=>modelJson({fetchImpl:intercepted,provider:providerConfig(env),
   model:"writer-model",prompt:"DRAFT_PRIVATE_NOT_FOR_OTHER_ORIGIN"}),/AI_PROVIDER_TRANSPORT_FAILED/);
 assert.equal(forwarded,0,"redirect policy must prevent sending the draft to a new origin");
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
 let cancelled=false,pulls=0;
 const stream=new ReadableStream({
   pull(controller){
     if(++pulls>10){controller.close();return;}
     controller.enqueue(new Uint8Array(150000));
   },
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
test("news cluster key must be stable by real article URLs, not transient RSS row positions",()=>tmp(async root=>{
 const first=await publish({root,fetchImpl:mockFetch(),env,now,feeds});
 assert.equal(first.status,"staged");
 const initialStore=JSON.parse(await fs.readFile(join(root,"content.json"),"utf8"));
 const firstCluster=initialStore.articles[0].clusterKey;
 const changedUrls=["https://openai.com/news/another-breakthrough","https://blog.google/ai/another-breakthrough"];
 const anotherDraft={...draft,slug:"ai-another-breakthrough-2026"};
 const secondBase=mockFetch({replyDraft:anotherDraft});
 const secondFetch=(url,options)=>{
   if(url===feeds[0].url)return rssResponse(item(changedUrls[0]),url);
   if(url===feeds[1].url)return rssResponse(item(changedUrls[1]),url);
   return secondBase(url,options);
 };
 const next=await publish({root,fetchImpl:secondFetch,env,now,feeds});
 assert.equal(next.status,"staged","new official URLs must remain eligible for a new article");
 const updated=JSON.parse(await fs.readFile(join(root,"content.json"),"utf8"));
 assert.equal(updated.articles.length,2);
 assert.notEqual(updated.articles[0].clusterKey,firstCluster,
   "different official URLs at the same RSS indices must NOT share one news cluster identity");
}));

test("duplicate is NOOP, not a duplicate publication",()=>tmp(async root=>{
 await publish({root,fetchImpl:mockFetch(),env,now,feeds});
 const again=await publish({root,fetchImpl:mockFetch(),env,now,feeds});
 assert.equal(again.status,"noop");
 assert.equal(JSON.parse(await fs.readFile(join(root,"content.json"),"utf8")).articles.length,1);
}));
test("duplicate source feeds must not consume any model calls before noop",()=>tmp(async root=>{
 const original=await fs.readFile(join(root,"content.json"),"utf8");
 const calls=[];
 const fetchImpl=async (url,options)=>{
   if(url===env.AI_CHAT_COMPLETIONS_URL){calls.push(JSON.parse(options.body));throw Error("METERED_MODEL_MUST_NOT_RUN_ON_KNOWN_SOURCES");}
   return mockFetch()(url,options);
 };
 const result=await publish({root,fetchImpl,env,now,feeds});
 assert.equal(result.status,"noop");
 assert.deepEqual(calls,[],"already-published sources must be filtered before a metered AI request");
 assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),original);
 assert.deepEqual(await fs.readdir(root),["content.json"]);
},{articles:[{slug:"prior-verified-story",sources:[
  "https://openai.com/news/one?utm_source=old-alert",
  "https://blog.google/ai/two?fbclid=old-session"
]}]}));

test("publisher deduplicates same official story despite differing UTM tracking parameters",()=>tmp(async root=>{
 const before=await fs.readFile(join(root,"content.json"),"utf8");
 const result=await publish({root,fetchImpl:mockFetch(),env,now,feeds});
 assert.equal(result.status,"noop",
   "same official source with only tracking-parameter variation must not be published again");
 assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
 assert.deepEqual(await fs.readdir(root),["content.json"],"duplicate must create no cover");
}, {articles:[{slug:"an-earlier-slug-for-the-same-news",
 sources:["https://openai.com/news/one?utm_source=old-alert&utm_medium=rss"]}]}));

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


test("RSS with declared excessive body length is rejected before buffering any bytes",()=>tmp(async root=>{
  let bodyReads=0,modelCalls=0;
  const intercepted=async url=>{
    if(url===feeds[0].url)return {
      ok:true,url,headers:{get:name=>name==="content-length"?"2000001":null},
      text:async()=>{bodyReads++;return item(data[0].url);}
    };
    if(url===feeds[1].url)return rssResponse(item(data[1].url),url);
    modelCalls++;throw Error("MODEL_MUST_NOT_BE_CALLED");
  };
  const result=await publish({root,fetchImpl:intercepted,env,now,feeds});
  assert.equal(result.status,"noop");
  assert.equal(bodyReads,0,"an oversized RSS body must not be read into memory even if the returned text is small");
  assert.equal(modelCalls,0);
  assert.equal(JSON.parse(await fs.readFile(join(root,"content.json"),"utf8")).articles.length,0);
}));

test("chunked RSS larger than 2 MB is cancelled without consuming the whole stream",()=>tmp(async root=>{
  let cancelled=false,pulls=0,modelCalls=0;
  const chunks=new ReadableStream({
    pull(controller){
      if(++pulls>6){controller.close();return;}
      controller.enqueue(new Uint8Array(750000));
    },
    cancel(){cancelled=true;}
  });
  const oversized=new Response(chunks,{status:200,headers:{"content-type":"application/rss+xml"}});
  Object.defineProperty(oversized,"url",{value:feeds[0].url});
  const intercepted=async url=>{
    if(url===feeds[0].url)return oversized;
    if(url===feeds[1].url)return rssResponse(item(data[1].url),url);
    modelCalls++;throw Error("MODEL_MUST_NOT_BE_CALLED");
  };
  const result=await publish({root,fetchImpl:intercepted,env,now,feeds});
  assert.equal(result.status,"noop");
  assert.equal(cancelled,true,"oversized chunked RSS must be cancelled rather than fully buffered");
  assert.ok(pulls<6,"do not consume all possible chunks after crossing the byte budget");
  assert.equal(modelCalls,0);
  assert.equal(JSON.parse(await fs.readFile(join(root,"content.json"),"utf8")).articles.length,0);
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
