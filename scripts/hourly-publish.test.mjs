import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import {join} from "node:path";
import {FEEDS,readBoundedHttpText,parseFeed,providerConfig,modelJson,validateDraft,verifyReview,coverSvg,publish,commitContentJsonAtomically,createCoverExclusively,summarizePublishResult} from "./hourly-publish.mjs";

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

test("Nested RSS and Atom body fields cannot spoof entry titles or freshness",()=>{
 const officialTitle="Actual official AI research publication with tested methodology";
 const nestedRss='<description><p>Publisher evidence with reproducible testing, observations and limitations. '+
   '<title>Fabricated source announcement</title><pubDate>'+date+'</pubDate></p></description>';
 const rss=timestamp=>'<rss><item>'+nestedRss+
   '<title>'+officialTitle+'</title><link>https://openai.com/news/authentic-research</link>'+
   '<pubDate>'+timestamp+'</pubDate></item></rss>';
 assert.equal(parseFeed(rss("Fri, 09 Oct 2026 23:00:00 GMT"),"openai",now).length,0,
   "nested RSS description date cannot renew a stale official article");
 const fresh=parseFeed(rss(date),"openai",now);
 assert.equal(fresh.length,1);
 assert.equal(fresh[0].title,officialTitle,
   "nested description title cannot override the direct RSS item title");
 const nestedAtom='<content type="xhtml"><div><h2>Publisher findings and documented limitations</h2>'+
   '<title>Fabricated Atom announcement</title><updated>2026-10-17T23:00:00Z</updated></div></content>';
 const atom=timestamp=>'<feed><entry>'+nestedAtom+
   '<title>'+officialTitle+'</title><updated>'+timestamp+'</updated>'+
   '<link rel="alternate" href="https://blog.google/ai/authentic-research"/></entry></feed>';
 assert.equal(parseFeed(atom("2026-10-09T23:00:00Z"),"google",now).length,0,
   "nested Atom XHTML updated cannot renew a stale official article");
 const freshAtom=parseFeed(atom("2026-10-17T23:00:00Z"),"google",now);
 assert.equal(freshAtom.length,1);
 assert.equal(freshAtom[0].title,officialTitle,
   "nested Atom body title cannot override the entry's publisher metadata");
});

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

test("feed outage is an error rather than NOOP_NO_QUALIFIED_STORY",()=>tmp(async root=>{
  const original=await fs.readFile(join(root,"content.json"),"utf8");
  let aiCalls=0;
  const outageFetch=async url=>{
    if(url===feeds[0].url)throw Error("NETWORK_DOWN");
    if(url===feeds[1].url)return new Response("upstream unavailable",{status:503});
    aiCalls++;throw Error("AI_MUST_NOT_RUN");
  };
  await assert.rejects(
    ()=>publish({root,fetchImpl:outageFetch,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/,
    "total official source outage must fail the scheduled Action");
  assert.equal(aiCalls,0);
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),original);
  assert.deepEqual(await fs.readdir(root),["content.json"]);
}));

test("one healthy feed and one failed feed is degraded not a quiet no-news run",()=>tmp(async root=>{
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  let aiCalls=0;
  const degradedFetch=async url=>{
    if(url===feeds[0].url)return rssResponse(item(data[0].url),url);
    if(url===feeds[1].url)throw Error("DNS_UNAVAILABLE");
    aiCalls++;throw Error("AI_MUST_NOT_RUN");
  };
  await assert.rejects(
    ()=>publish({root,fetchImpl:degradedFetch,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
  assert.equal(aiCalls,0);
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
  assert.deepEqual(await fs.readdir(root),["content.json"]);
}));

test("two reachable official feeds with only expired news remain a legitimate noop",()=>tmp(async root=>{
  let aiCalls=0;
  const oldDate="Mon, 01 Sep 2025 10:00:00 GMT";
  const stale=item(data[0].url).replace(date,oldDate);
  const staleTwo=item(data[1].url).replace(date,oldDate);
  const staleFetch=async url=>{
    if(url===feeds[0].url)return rssResponse(stale,url);
    if(url===feeds[1].url)return rssResponse(staleTwo,url);
    aiCalls++;throw Error("AI_MUST_NOT_RUN");
  };
  assert.deepEqual(await publish({root,fetchImpl:staleFetch,env,now,feeds}),{status:"noop"});
  assert.equal(aiCalls,0);
}));

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

test("Nested XHTML link elements within Atom content cannot impersonate the entry permalink",()=>{
 const start='<feed><entry><title>Official detailed AI research evaluation</title>'+
   '<updated>2026-10-17T23:00:00Z</updated>'+
   '<summary>Official report details independent evaluation methods with measurable results and important limitations.</summary>';
 const nested='<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">'+
   '<p>Links in article body are not Atom entry-level provenance.</p>'+
   '<link rel="alternate" type="text/html" href="https://blog.google/ai/phantom-nested-article"/>'+
   '</div></content>';
 const self='<link rel="self" href="https://blog.google/feed/entry/42"/>';
 const noArticle=parseFeed(start+nested+self+'</entry></feed>',"google",now);
 assert.equal(noArticle.length,0,
   "a nested XHTML resource must never be promoted to an Atom article link");
 const direct='<link rel="alternate" type="text/html" href="https://blog.google/ai/verified-article"/>';
 const actual=parseFeed(start+nested+self+direct+'</entry></feed>',"google",now);
 assert.equal(actual.length,1);
 assert.equal(actual[0].url,"https://blog.google/ai/verified-article",
   "entry-level permalink must outrank nested article-body links");
});

test("Nested XML link tags in RSS description cannot impersonate the article URL",()=>{
 const start='<rss><item><title>Official engineering model evaluation</title>'+
   '<pubDate>'+date+'</pubDate>';
 const nested='<description><p>Full evaluation with reproducible methods and limitations.</p>'+
   '<link>https://openai.com/news/phantom-description-link</link></description>';
 assert.equal(parseFeed(start+nested+'</item></rss>',"openai",now).length,0,
   "RSS description-body markup is not an article permalink");
 const direct='<link>https://openai.com/news/real-evaluation</link>';
 const valid=parseFeed(start+nested+direct+'</item></rss>',"openai",now);
 assert.equal(valid.length,1);
 assert.equal(valid[0].url,"https://openai.com/news/real-evaluation",
   "entry-level RSS link must take precedence over nested description markup");
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

test("Gemini HTTP503 recovers with exactly one bounded delayed retry and unchanged request",async t=>{
 const warns=[],delays=[],requests=[];
 t.mock.method(console,"warn",(...args)=>warns.push(args.join(" ")));
 const provider=providerConfig(env);
 const fetchImpl=async(url,options)=>{
   requests.push({url,method:options.method,redirect:options.redirect,body:options.body});
   if(requests.length===1)return new Response("temporarily overloaded",{status:503});
   return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}),
     {status:200,headers:{"content-type":"application/json"}});
 };
 const result=await modelJson({fetchImpl,provider,model:provider.writer,prompt:"test",
   sleepImpl:async ms=>delays.push(ms)});
 assert.deepEqual(result,{ok:true});
 assert.equal(requests.length,2,"never retry indefinitely");
 assert.deepEqual(requests[0],requests[1],"repeat only identical approved model request");
 assert.equal(requests[0].redirect,"error","never follow a credential-bearing POST redirect");
 assert.equal(delays.length,1);
 assert.ok(delays[0]>=1000&&delays[0]<=1250,"bounded jitter backoff");
 assert.deepEqual(warns,["AI_PROVIDER_HTTP_503_BACKOFF_ONCE"]);
 assert.ok(warns.every(line=>!line.includes(env.AI_API_KEY)));
});

test("persistent HTTP503 fails closed after one retry; quota/auth errors never retry",async t=>{
 const warnings=[],provider=providerConfig(env);
 t.mock.method(console,"warn",(...args)=>warnings.push(args.join(" ")));
 for(const code of [503,401,403,429]){
   let calls=0;const delays=[];
   const fetchImpl=async()=>{calls++;return new Response(null,{status:code});};
   await assert.rejects(()=>modelJson({fetchImpl,provider,model:provider.writer,prompt:"test",
     sleepImpl:async ms=>delays.push(ms)}),new RegExp("AI_PROVIDER_HTTP_"+code));
   assert.equal(calls,code===503?2:1,"no unauthorized retries");
   assert.equal(delays.length,code===503?1:0);
 }
 assert.deepEqual(warnings,["AI_PROVIDER_HTTP_503_BACKOFF_ONCE"]);
});

test("AI JSON responses require application/json media type, not JSONP or lookalikes",async()=>{
 const provider=providerConfig(env);
 const body=JSON.stringify({choices:[{message:{content:JSON.stringify({ok:true})}}]});
 for(const mediaType of ["application/jsonp","application/json-seq","text/json","application/x-ndjson"]){
   let consumed=false;
   const fetchImpl=async()=>({ok:true,status:200,headers:{get:name=>name==="content-type"?mediaType:null},
     text:async()=>{consumed=true;return body;}});
   await assert.rejects(()=>modelJson({fetchImpl,provider,model:provider.writer,prompt:"test"}),
     /AI_PROVIDER_NON_JSON_RESPONSE/,mediaType+" must fail closed");
   assert.equal(consumed,false,"invalid media type must be refused before reading payload");
 }
});

test("AI JSON media type rejects malformed parameter syntax before reading provider data",async()=>{
 const provider=providerConfig(env);
 const body=JSON.stringify({choices:[{message:{content:JSON.stringify({ok:true})}}]});
 for(const mediaType of ["application/json;garbage","application/json; charset",
   "application/json; charset=utf-8, text/html","application/json; charset=\"unterminated"]){
   let consumed=false;
   const fetchImpl=async()=>({ok:true,status:200,
     headers:{get:name=>name==="content-type"?mediaType:null},
     text:async()=>{consumed=true;return body;}});
   await assert.rejects(()=>modelJson({fetchImpl,provider,model:provider.writer,prompt:"test"}),
     /AI_PROVIDER_NON_JSON_RESPONSE/,mediaType+" is malformed and must fail closed");
   assert.equal(consumed,false,"malformed provider MIME header must be rejected before consuming body");
 }
});

test("AI JSON responses accept canonical media type with case and charset",async()=>{
 const provider=providerConfig(env);
 const body=JSON.stringify({choices:[{message:{content:JSON.stringify({ok:true})}}]});
 for(const mediaType of ["application/json","application/json; charset=utf-8",
   "Application/JSON; charset=UTF-8",'application/json; charset="utf-8"']){
   const fetchImpl=async()=>new Response(body,{status:200,headers:{"content-type":mediaType}});
   assert.deepEqual(await modelJson({fetchImpl,provider,model:provider.writer,prompt:"test"}),{ok:true});
 }
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

test("SVG cover must never emit lone UTF-16 surrogate after title truncation",()=>{
  const loneHigh="Untrusted news "+String.fromCharCode(0xd800)+" headline";
  const loneLow="Untrusted news "+String.fromCharCode(0xdc00)+" headline";
  const truncatedPair="A".repeat(69)+"\u{1F680} next";
  for(const title of [loneHigh,loneLow,truncatedPair]){
    const svg=coverSvg(title);
    assert.doesNotMatch(svg,/[\uD800-\uDFFF]/u,
      "an unpaired UTF-16 surrogate produces invalid XML and must not be written into an SVG cover");
    assert.match(svg,/<\/svg>\n$/);
  }
  const fullyIncluded=coverSvg("A".repeat(68)+"\u{1F680}");
  assert.match(fullyIncluded,/\u{1F680}/u,
    "legitimate non-BMP Unicode characters should be retained when they fit");
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
test("no-verifiable-story has non-secret source packet diagnostics without changing editorial gates",t=>tmp(async root=>{
 const messages=[];
 t.mock.method(console,"log",(...args)=>messages.push(args.join(" ")));
 const before=await fs.readFile(join(root,"content.json"),"utf8");
 const result=await publish({root,fetchImpl:mockFetch({replyDraft:{noQualifiedStory:true}}),env,now,feeds});
 assert.deepEqual(result,{status:"noop"});
 assert.ok(messages.includes("SOURCE_PACKET_READY items=2 publishers=2"),
   "publisher should explain bounded independent source packet size before writer NOOP");
 assert.ok(messages.includes("NOOP_NO_VERIFIABLE_STORY"),
   "do not reclassify an evidence-based writer refusal as publication");
 const diagnostics=messages.filter(message=>message.startsWith("SOURCE_PACKET_READY"));
 assert.equal(diagnostics.length,1);
 assert.ok(diagnostics.every(message=>!message.includes("https://")&&!message.includes(officialTitle)&&!message.includes(env.AI_API_KEY)),
   "diagnostic must contain counts only, never URLs, feed excerpts or credentials");
 assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
 assert.deepEqual(await fs.readdir(root),["content.json"]);
}));

test("source packet diagnostics also accompany verified staging without exposing source text",t=>tmp(async root=>{
 const messages=[];
 t.mock.method(console,"log",(...args)=>messages.push(args.join(" ")));
 const result=await publish({root,fetchImpl:mockFetch(),env,now,feeds});
 assert.equal(result.status,"staged");
 assert.equal(messages.filter(message=>message==="SOURCE_PACKET_READY items=2 publishers=2").length,1);
 assert.ok(messages.some(message=>message.startsWith("AUTO_PUBLISH_READY ")));
 const diagnostics=messages.filter(message=>message.startsWith("SOURCE_PACKET_READY"));
 assert.ok(diagnostics.every(message=>!message.includes("https://")&&!message.includes(officialTitle)&&!message.includes(env.AI_API_KEY)));
 const store=JSON.parse(await fs.readFile(join(root,"content.json"),"utf8"));
 assert.deepEqual(Object.keys(store.articles[0].editions).sort(),["en","es","vi"]);
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
  await assert.rejects(
    ()=>publish({root,fetchImpl:intercepted,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
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
  await assert.rejects(
    ()=>publish({root,fetchImpl:intercepted,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
  assert.equal(cancelled,true,"oversized chunked RSS must be cancelled rather than fully buffered");
  assert.ok(pulls<6,"do not consume all possible chunks after crossing the byte budget");
  assert.equal(modelCalls,0);
  assert.equal(JSON.parse(await fs.readFile(join(root,"content.json"),"utf8")).articles.length,0);
}));

test("HTTP failure in one of three feeds emits an Action warning while healthy empty feeds noop",t=>tmp(async root=>{
  const notes=[];
  t.mock.method(console,"warn",(...args)=>notes.push(args.join(" ")));
  const third={id:"github",url:"https://github.blog/changelog/feed/"};
  const expired="Mon, 01 Sep 2025 10:00:00 GMT";
  const source={google:item(data[1].url).replace(date,expired),
    github:item("https://github.blog/changelog/safe-entry").replace(date,expired)};
  const noAiFetch=async url=>{
    if(url===feeds[0].url)return new Response("unavailable",{status:503});
    if(url===feeds[1].url)return rssResponse(source.google,url);
    if(url===third.url)return rssResponse(source.github,url);
    throw Error("AI_MUST_NOT_RUN");
  };
  const response=await publish({root,fetchImpl:noAiFetch,env,now,feeds:[...feeds,third]});
  assert.equal(response.status,"noop");
  assert.ok(notes.some(note=>note.includes("FEED_HTTP_UNAVAILABLE openai 503")),
    "degraded feed should produce an actionable GitHub Actions annotation");
  assert.deepEqual(await fs.readdir(root),["content.json"]);
}));

for(const scenario of ["transport-error","invalid-document"]){
 test("partial official feed "+scenario+" yields an actionable warning and keeps no-news noop",t=>tmp(async root=>{
  const notes=[];
  t.mock.method(console,"warn",(...args)=>notes.push(args.join(" ")));
  const third={id:"github",url:"https://github.blog/changelog/feed/"};
  const expired="Mon, 01 Sep 2025 10:00:00 GMT";
  const fetchImpl=async url=>{
   if(url===feeds[0].url){
    if(scenario==="transport-error")throw Error("FAKE_NETWORK_DOWN");
    return rssResponse("<html><body>Login required</body></html>",url);
   }
   if(url===feeds[1].url)return rssResponse(item(data[1].url).replace(date,expired),url);
   if(url===third.url)return rssResponse(item("https://github.blog/changelog/testing").replace(date,expired),url);
   throw Error("NO_MODEL_REQUEST_ALLOWED");
  };
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  const outcome=await publish({root,fetchImpl,env,now,feeds:[...feeds,third]});
  assert.equal(outcome.status,"noop");
  const expected=scenario==="transport-error"?"FEED_FETCH_FAILED openai":"FEED_DOCUMENT_INVALID openai";
  assert.ok(notes.some(note=>note.includes("::warning")&&note.includes(expected)),
   "partial feed failure must appear as a GitHub Actions warning");
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
 }));
}


test("HTTP 200 HTML with a pasted RSS example is not a genuine readable official feed",()=>tmp(async root=>{
 const before=await fs.readFile(join(root,"content.json"),"utf8");
 let aiCalls=0;
 const deceptiveHtml="<html><body><h1>Temporarily unavailable</h1><pre><rss><item><title>Sample only</title></item></rss></pre></body></html>";
 const fakeFetch=async url=>{
  if(url===feeds[0].url)return rssResponse(item(data[0].url),url);
  if(url===feeds[1].url)return rssResponse(deceptiveHtml,url);
  aiCalls++;throw Error("AI_MUST_NOT_RUN");
 };
 await assert.rejects(
  ()=>publish({root,fetchImpl:fakeFetch,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/,
  "embedded sample markup in HTTP 200 HTML must not satisfy publisher quorum");
 assert.equal(aiCalls,0);
 assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
 assert.deepEqual(await fs.readdir(root),["content.json"]);
}));

test("genuine RSS with BOM, XML declaration and leading comment still counts as a feed",()=>tmp(async root=>{
 const original=mockFetch();
 const bom=String.fromCharCode(0xfeff);
 const wrapped=bom+'<?xml version="1.0" encoding="UTF-8"?>\n<!-- legal publisher preamble -->\n'+item(data[0].url);
 assert.deepEqual(parseFeed(bom+'  <?xml version="1.0"?>'+item(data[0].url),"openai",now),[],
   "XML declaration after whitespace, even when a true BOM is present, is invalid");
 const fetchImpl=async (url,options)=>url===feeds[0].url?rssResponse(wrapped,url):original(url,options);
 const result=await publish({root,fetchImpl,env,now,feeds});
 assert.equal(result.status,"staged","normal XML preamble must not break official RSS");
 assert.equal(JSON.parse(await fs.readFile(join(root,"content.json"),"utf8")).articles.length,1);
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
 await assert.rejects(
   ()=>publish({root,fetchImpl:divertedFetch,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/,
   "off-domain RSS redirect must not count as official publisher evidence");
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
  await assert.rejects(
    ()=>publish({root,fetchImpl:guardedFetch,env,now,feeds:[forged,otherFeed]}),/FEED_QUORUM_UNAVAILABLE/);
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
  await assert.rejects(
    ()=>publish({root,fetchImpl:guardedFetch,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
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

test("truncated RSS or Atom root cannot falsely satisfy the official feed quorum",()=>tmp(async root=>{
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  const original=mockFetch();
  const truncated=[
    {kind:"RSS",xml:item(data[1].url).replace(/<\/rss>$/,"")},
    {kind:"Atom",xml:'<feed><entry><title>Official analysis with reproduced evidence</title>'+
      '<updated>2026-10-17T23:00:00Z</updated>'+
      '<summary>Official source explains evaluation methods, results and important limitations.</summary>'+
      '<link rel="alternate" href="https://blog.google/ai/two"/></entry>'}
  ];
  for(const {kind,xml} of truncated){
    let aiCalls=0;
    const fetchImpl=async (url,options)=>{
      if(url===feeds[1].url)return rssResponse(xml,url);
      if(url===feeds[0].url)return rssResponse(item(data[0].url).replace(date,"Mon, 01 Sep 2025 10:00:00 GMT"),url);
      aiCalls++;return original(url,options);
    };
    await assert.rejects(
      ()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/,
      kind+" incomplete official document must count as an unavailable feed, not a healthy document");
    assert.equal(aiCalls,0,kind+" cannot reach metered AI provider");
    assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
  }
}));

test("closed RSS/Atom roots with broken inner XML cannot count as healthy official feeds",()=>tmp(async root=>{
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  const broken=[
    {kind:"rss-unclosed-item",xml:"<rss><item><title>Incomplete entry</title></rss>"},
    {kind:"atom-unclosed-entry",xml:"<feed><entry><title>Incomplete entry</title></feed>"},
    {kind:"rss-misnested-tags",xml:"<rss><item><title>Swapped closures</item></title></rss>"},
    {kind:"atom-truncated-summary",xml:"<feed><entry><summary>Broken</entry></feed>"}
  ];
  for(const {kind,xml} of broken){
    let aiCalls=0;
    const fetchImpl=async (url)=>{
      if(url===feeds[0].url)return rssResponse(item(data[0].url).replace(date,"Mon, 01 Sep 2025 10:00:00 GMT"),url);
      if(url===feeds[1].url)return rssResponse(xml,url);
      aiCalls++;throw Error("AI_MUST_NOT_RUN");
    };
    await assert.rejects(
      ()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/,
      kind+" incomplete nested XML must not count toward the readable quorum");
    assert.equal(aiCalls,0,kind+" cannot call AI with incomplete source evidence");
    assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
  }
}));

test("Atom embedded source metadata cannot impersonate entry title date or permalink",()=>{
  const authenticTitle="Actual official AI safety research with published evaluation methods";
  const authenticLink="https://blog.google/ai/authentic-atom-research";
  const nestedSource='<source>'+
    '<title>Fabricated urgent AI results from source-level metadata</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<link rel="alternate" href="https://blog.google/ai/forged-source-link"/>'+
    '</source>';
  const entry=timestamp=>'<feed><entry>'+nestedSource+
    '<title>'+authenticTitle+'</title>'+
    '<updated>'+timestamp+'</updated>'+
    '<summary>Official publisher explains evaluation evidence, techniques and limitations in detail.</summary>'+
    '<link rel="alternate" href="'+authenticLink+'"/>'+
    '</entry></feed>';
  assert.equal(parseFeed(entry("2026-10-09T23:00:00Z"),"google",now).length,0,
    "Atom source.updated must not refresh an expired entry");
  const fresh=parseFeed(entry("2026-10-17T23:00:00Z"),"google",now);
  assert.equal(fresh.length,1);
  assert.equal(fresh[0].title,authenticTitle);
  assert.equal(fresh[0].url,authenticLink,
    "Atom source.link must not replace an entry's real article permalink");
});

test("nested fake item within RSS channel description and Atom subtitle cannot become official source entries",()=>{
  const validRss='<item><title>Real publisher model research with reproducible evaluation</title>'+
    '<link>https://openai.com/news/real-article</link><pubDate>'+date+'</pubDate>'+
    '<description>Real publisher documents methods, caveats and experimental results.</description></item>';
  const fakeRss='<item><title>Fabricated urgent AI safety finding leaked inside descriptive markup</title>'+
    '<link>https://openai.com/news/fake-embedded-story</link><pubDate>'+date+'</pubDate>'+
    '<description>Embedded example only; never an independent official RSS story.</description></item>';
  const rss='<rss><channel><description><example>'+fakeRss+'</example></description>'+validRss+'</channel></rss>';
  const rssFound=parseFeed(rss,"openai",now);
  assert.deepEqual(rssFound.map(x=>x.url),["https://openai.com/news/real-article"],
    "only a direct RSS channel item may become a publisher article");
  const fakeAtom='<entry><title>Fabricated Atom AI system research announcement</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Embedded example, not an authentic independent official Atom story.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/embedded-forgery"/></entry>';
  const atom='<feed><subtitle><example>'+fakeAtom+'</example></subtitle></feed>';
  assert.deepEqual(parseFeed(atom,"google",now),[],
    "Atom entry nested inside subtitle is not a direct feed entry");
});

test("fake RSS channel or Atom feed nested inside description cannot launder a direct-looking article",()=>{
  const rss='<rss><channel><description><rss><channel><item>'+
    '<title>Fake security announcement nested under a forged channel</title>'+
    '<link>https://openai.com/news/nested-channel-forgery</link>'+
    '<pubDate>'+date+'</pubDate>'+
    '<description>Embedded sample with invented details; not an authentic publisher story.</description>'+
    '</item></channel></rss></description></channel></rss>';
  assert.deepEqual(parseFeed(rss,"openai",now),[],
    "the entry must descend directly from the top-level RSS channel, not an inner channel");
  const atom='<feed><subtitle><feed><entry>'+
    '<title>Fake Atom AI release inside a nested feed object</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Embedded sample with fake technical claims; not independently published news.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/nested-feed-forgery"/>'+
    '</entry></feed></subtitle></feed>';
  assert.deepEqual(parseFeed(atom,"google",now),[],
    "Atom entry must belong directly to the document feed root");
});

test("two structurally nested fake entries must never reach the AI writer or mutate content",()=>tmp(async root=>{
  const original=await fs.readFile(join(root,"content.json"),"utf8");
  const embeddedRss='<item><title>Fake official AI breaking announcement inside examples</title>'+
    '<link>https://openai.com/news/forged-inner-item</link><pubDate>'+date+'</pubDate>'+
    '<description>Illustrative example only, not independent publisher evidence.</description></item>';
  const rss='<rss><channel><description><section>'+embeddedRss+'</section></description></channel></rss>';
  const embeddedAtom='<entry><title>Fabricated publisher AI announcement from example data</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Embedded demonstration data, not a signed public feed entry.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/forged-inner-entry"/></entry>';
  const atom='<feed><subtitle><example>'+embeddedAtom+'</example></subtitle></feed>';
  let aiCalls=0;
  const fetchImpl=async url=>{
    if(url===feeds[0].url)return rssResponse(rss,url);
    if(url===feeds[1].url)return rssResponse(atom,url);
    aiCalls++;throw Error("FORGED_FEED_REACHED_AI_WRITER");
  };
  const outcome=await publish({root,fetchImpl,env,now,feeds});
  assert.equal(outcome.status,"noop","ghost source entries cannot trigger publication");
  assert.equal(aiCalls,0,"no model requests on nested article forgeries");
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),original);
  assert.deepEqual(await fs.readdir(root),["content.json"]);
}));

test("nested RSS and Atom extension metadata cannot impersonate direct entry title date and permalink",()=>{
  const old="Thu, 08 Oct 2026 23:00:00 GMT";
  const fakeRss='<vendor:example><title>Fabricated breaking announcement in foreign metadata</title>'+
    '<pubDate>'+date+'</pubDate>'+
    '<link>https://openai.com/news/fake-extension</link></vendor:example>';
  const rss=stamp=>'<rss><channel><item>'+fakeRss+
    '<title>Real original evaluation with published methods and limitations</title>'+
    '<pubDate>'+stamp+'</pubDate>'+
    '<link>https://openai.com/news/authentic-extension-proof</link>'+
    '<description>Legitimate original publisher summary with detailed results and important limitations.</description>'+
    '</item></channel></rss>';
  assert.deepEqual(parseFeed(rss(old),"openai",now),[],
    "foreign RSS extension pubDate must never renew an expired article");
  const realRss=parseFeed(rss(date),"openai",now);
  assert.equal(realRss.length,1);
  assert.equal(realRss[0].title,"Real original evaluation with published methods and limitations");
  assert.equal(realRss[0].url,"https://openai.com/news/authentic-extension-proof");
  const foreignAtom='<author><name><title>Invented model launch in author extension</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<link rel="alternate" href="https://blog.google/ai/fake-author-link"/></name></author>';
  const atom=stamp=>'<feed><entry>'+foreignAtom+
    '<title>Real official model assessment with documented limitations</title>'+
    '<updated>'+stamp+'</updated>'+
    '<summary>Original publisher describes replicated tests, evaluation conditions and important caveats.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/real-extension-proof"/>'+
    '</entry></feed>';
  assert.deepEqual(parseFeed(atom("2026-10-08T23:00:00Z"),"google",now),[],
    "nested author.updated must not freshen an expired Atom entry");
  const realAtom=parseFeed(atom("2026-10-17T23:00:00Z"),"google",now);
  assert.equal(realAtom.length,1);
  assert.equal(realAtom[0].title,"Real official model assessment with documented limitations");
  assert.equal(realAtom[0].url,"https://blog.google/ai/real-extension-proof");
});

test("nested title markup cannot masquerade as an RSS or Atom entry permalink",()=>{
  const title='<title>Genuine evaluation and documented research '+
    '<span><link>https://openai.com/news/forged-title-permalink</link></span></title>';
  const rss=link=>'<rss><channel><item>'+title+
    '<pubDate>'+date+'</pubDate>'+
    '<description>Publisher describes independently evaluated methods, limitations and outcomes.</description>'+
    link+'</item></channel></rss>';
  assert.deepEqual(parseFeed(rss(""),"openai",now),[],
    "nested RSS title.link cannot substitute for a direct item link");
  assert.equal(parseFeed(rss('<link>https://openai.com/news/real-permalink</link>'),"openai",now)[0]?.url,
    "https://openai.com/news/real-permalink",
    "real direct RSS item link must outrank nested markup");
  const fake='<title type="xhtml"><div>Authenticated AI research summary '+
    '<link rel="alternate" href="https://blog.google/ai/forged-xhtml-title"/></div></title>';
  const atom=link=>'<feed><entry>'+fake+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Publisher describes independent technical evaluation with evidence and caveats.</summary>'+
    link+'</entry></feed>';
  assert.deepEqual(parseFeed(atom(""),"google",now),[],
    "XHTML Atom title.link cannot substitute for a direct entry alternate link");
  assert.equal(parseFeed(atom('<link rel="alternate" href="https://blog.google/ai/real-permalink"/>'),"google",now)[0]?.url,
    "https://blog.google/ai/real-permalink");
});


test("separate top-level XML roots must not satisfy official feed quorum",()=>tmp(async root=>{
  const saved=await fs.readFile(join(root,"content.json"),"utf8");
  const fakeRss='<rss></rss>'+item(data[1].url);
  const fakeAtom='<feed></feed><feed><entry>'+
    '<title>Invented official AI research with measurable outcomes</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Fake news embedded after a complete document; this is not a well-formed XML feed.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/fake-second-root"/>'+
    '</entry></feed>';
  for(const [kind,body] of [["RSS",fakeRss],["Atom",fakeAtom]]){
    let modelCalls=0;
    const fetchImpl=async url=>{
      if(url===feeds[0].url)return rssResponse(item(data[0].url),url);
      if(url===feeds[1].url)return rssResponse(body,url);
      modelCalls++;throw Error("UNTRUSTWORTHY_XML_REACHED_METERED_AI");
    };
    await assert.rejects(
      ()=>publish({root,fetchImpl,env,now,feeds}),
      /FEED_QUORUM_UNAVAILABLE/,
      kind+" concatenated root documents must fail closed before model invocation");
    assert.equal(modelCalls,0,kind+" invalid XML must never reach AI");
    assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),saved);
  }
}));


test("reject non-whitespace bytes outside the official single XML root",()=>{
  const valid=item(data[0].url);
  assert.equal(parseFeed(valid,"openai",now).length,1,"baseline valid feed must work");
  for(const malformed of [
    "UNTRUSTED_PREFIX"+valid,
    valid+"UNTRUSTED_TRAILER",
    "<!--allowed prolog comment-->UNTRUSTED_PREFIX"+valid,
  ]){
    assert.deepEqual(parseFeed(malformed,"openai",now),[],
      "a single balanced XML root with non-markup outside is not a well-formed publisher feed");
  }
  assert.equal(parseFeed(" \n"+valid+"\n ","openai",now).length,1,
    "whitespace outside a single root must remain valid");
});


test("opt-in real official public-feed quorum on the scoped GitHub PR, never AI or publish",{skip:!(
  process.env.GITHUB_ACTIONS==="true"&&
  process.env.GITHUB_HEAD_REF==="fix/gh4456-truncated-official-feed-root-20261019-nv02")},async()=>{
  // Only read official public feeds. Bounded bytes/timeout, no tokens, writes or
  // third-party redirects. External reachability is a preflight observation,
  // not approval to merge, use a metered model, or publish.
  const current=new Date();
  const observations=[];
  for(const feed of FEEDS){
    try{
      const endpoint=new URL(feed.url);
      assert.equal(endpoint.protocol,"https:");
      let target=endpoint.href;
      let res=null;
      let redirectViolation=null;
      for(let hops=0;hops<=3;hops++){
        const requested=new URL(target);
        if(requested.protocol!=="https:"||requested.username||requested.password||
          requested.hostname!==endpoint.hostname){
          redirectViolation="ORIGIN_CHANGE";break;
        }
        res=await fetch(requested.href,{
          redirect:"manual",
          headers:{"user-agent":"TigerIQ-News/2.0"},
          signal:AbortSignal.timeout(12000)
        });
        if([301,302,303,307,308].includes(res.status)){
          if(hops===3){redirectViolation="REDIRECT_LIMIT";break;}
          const location=res.headers.get("location");
          if(!location){redirectViolation="MISSING_LOCATION";break;}
          try{target=new URL(location,requested).href;}
          catch{redirectViolation="BAD_LOCATION";break;}
          continue;
        }
        break;
      }
      if(redirectViolation){
        observations.push({id:feed.id,status:redirectViolation,valid:false});continue;
      }
      if(!res?.ok){
        observations.push({id:feed.id,status:res?.status||"NO_RESPONSE",valid:false});continue;
      }
      const xml=await readBoundedHttpText(res,2_000_000,"FEED_RESPONSE_TOO_LARGE");
      const valid=/^\uFEFF?\s*(?:<\?xml\b[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)(?=\s|>)/i.test(xml);
      const rows=valid?parseFeed(xml,feed.id,current):[];
      observations.push({id:feed.id,status:res.status,valid,bytes:Buffer.byteLength(xml),fresh:rows.length});
    }catch(e){
      observations.push({id:feed.id,status:e?.message||"FETCH_FAILED",valid:false});
    }
  }
  // Metadata only: never log source bodies, article text or model payloads.
  console.log("OFFICIAL_PUBLIC_FEED_PREFLIGHT "+JSON.stringify(observations));
  assert.ok(observations.filter(x=>x.valid).length>=2,
    "two independent official public RSS/Atom feeds must be readable");
},70000);


test("malformed XML closing tags with injected attributes never become official publisher items",()=>{
  const validRss=item(data[0].url);
  const invalidRss=validRss.replace("</item>","</item ignored='pretend-valid'>");
  assert.equal(parseFeed(validRss,"openai",now).length,1,"baseline RSS must remain accepted");
  assert.deepEqual(parseFeed(invalidRss,"openai",now),[],
    "XML closing tags cannot contain attributes, even when stack tag names balance");

  const validAtom='<feed><entry><title>Validated technical findings across independent datasets</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official researchers describe their observed technical findings, methods, limitations and caveats.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/confirmed-technical-findings"/>'+
    '</entry></feed>';
  const invalidAtom=validAtom.replace("</entry>","</entry injected='metadata'>");
  assert.equal(parseFeed(validAtom,"google",now).length,1,"baseline Atom must remain accepted");
  assert.deepEqual(parseFeed(invalidAtom,"google",now),[],
    "malformed Atom closing tags cannot satisfy the official feed quorum");
});


test("a fourth same-publisher RSS redirect is never requested and cannot fake quorum",()=>tmp(async root=>{
  // Regression: even HTTPS redirects on an approved publisher host must stop
  // before hop 4. No AI request or content mutation may follow a fake quorum.
  const hops=[
    "https://openai.com/news/rss.xml",
    "https://openai.com/news/redirect-1",
    "https://openai.com/news/redirect-2",
    "https://openai.com/news/redirect-3",
    "https://openai.com/news/redirect-4"
  ];
  const requested=[];
  const fetchImpl=async (url,options)=>{
    if(url===feeds[1].url)return rssResponse("<rss></rss>",url);
    requested.push(url);
    assert.equal(options?.redirect,"manual","redirect handling must stay explicit");
    const step=hops.indexOf(url);
    if(step<0)throw Error("UNEXPECTED_EXTERNAL_REQUEST");
    if(step===4)throw Error("FOURTH_REDIRECT_WAS_FETCHED");
    return new Response(null,{status:302,headers:{location:hops[step+1]}});
  };
  await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
  assert.deepEqual(requested,hops.slice(0,4),"never request the fifth URL after 4 redirects");
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),'{"articles":[]}',
    "failed quorum must preserve canonical content byte for byte");
}));


test("unquoted opening XML attributes must never become official RSS or Atom evidence",()=>{
  const rss=item(data[0].url);
  const brokenRss=rss.replace("<item>","<item poisoned=unquoted>");
  assert.equal(parseFeed(rss,"openai",now).length,1,"valid RSS baseline accepted");
  assert.deepEqual(parseFeed(brokenRss,"openai",now),[],
    "XML attributes without quote delimiters must not become authentic source metadata");
  const atom='<feed><entry><title>Real independently sourced AI research results</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official scientists describe their measured technical evaluation and caveats.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/real-open-tag"/></entry></feed>';
  const brokenAtom=atom.replace("<entry>","<entry invented=bare>");
  assert.equal(parseFeed(atom,"google",now).length,1,"valid Atom baseline accepted");
  assert.deepEqual(parseFeed(brokenAtom,"google",now),[],
    "a malformed Atom opening tag must never count as official publisher evidence");
});


test("duplicate XML attribute names must not become publisher evidence",()=>{
  const baseline=item(data[0].url);
  const malformedRss=baseline.replace("<item>","<item id=\"first\" id=\"second\">");
  assert.equal(parseFeed(baseline,"openai",now).length,1,"well-formed RSS remains valid");
  assert.deepEqual(parseFeed(malformedRss,"openai",now),[],
    "a duplicate XML attribute invalidates the official RSS document");

  const atom='<feed><entry><title>Official independent AI research evaluation findings</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official independent technical study includes measured evidence and methodological caveats.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/actual-research"/></entry></feed>';
  const malformedAtom=atom.replace('rel="alternate"','rel="alternate" rel="self"');
  assert.equal(parseFeed(atom,"google",now).length,1,"well-formed Atom remains valid");
  assert.deepEqual(parseFeed(malformedAtom,"google",now),[],
    "duplicate Atom link relations are not well-formed publisher evidence");
});


test("XML whitespace after a markup opener must not become an official RSS or Atom article",()=>{
  const rss=item(data[0].url);
  assert.equal(parseFeed(rss,"openai",now).length,1,"valid RSS still accepted");
  for(const broken of [
    rss.replace("<item>","< item>"),
    rss.replace("</item>","</ item>")
  ]){
    assert.deepEqual(parseFeed(broken,"openai",now),[],
      "whitespace between < or </ and an XML tag name makes the document malformed");
  }
  const atom='<feed><entry><title>Real official AI research with methods and limitations</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official research release describes empirical evaluation and reproducible methodology.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/real-entry"/></entry></feed>';
  assert.equal(parseFeed(atom,"google",now).length,1,"valid Atom still accepted");
  for(const broken of [
    atom.replace("<entry>","< entry>"),
    atom.replace("</entry>","</ entry>")
  ]){
    assert.deepEqual(parseFeed(broken,"google",now),[],
      "invalid whitespace around Atom entry openers cannot launder published evidence");
  }
});


test("quoted XML attribute values containing name-equals fragments remain valid official feeds",()=>{
  const baseline=item(data[0].url);
  const validRss=baseline.replace("<item>",'<item data-note="literal id=inside" id="real">');
  assert.equal(parseFeed(baseline,"openai",now).length,1,"RSS baseline must be genuine");
  assert.equal(parseFeed(validRss,"openai",now).length,1,
    "attribute-name-looking bytes inside quoted RSS values must not be counted as attributes");
  assert.deepEqual(parseFeed(baseline.replace("<item>",'<item id="one" id="two">'),"openai",now),[],
    "genuinely duplicated RSS attributes must remain rejected");

  const atom='<feed><entry><title>Real published AI systems research results</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official experiment reports verified results with detailed caveats and reproducibility.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/real-quoted-attributes"/></entry></feed>';
  const validAtom=atom.replace("<entry>",'<entry data-note="literal ref=inside" ref="real">');
  assert.equal(parseFeed(atom,"google",now).length,1,"Atom baseline must be genuine");
  assert.equal(parseFeed(validAtom,"google",now).length,1,
    "valid quoted Atom values cannot invent duplicate attributes");
  assert.deepEqual(parseFeed(atom.replace("<entry>",'<entry ref="one" ref="two">'),"google",now),[],
    "genuinely duplicated Atom attributes must remain rejected");
});


test("malformed XML comments with internal double hyphen cannot authenticate publisher feeds",()=>tmp(async root=>{
  const rss=item(data[0].url);
  const validRss=rss.replace("<item>","<!-- legitimate source-side note --><item>");
  const badRss=rss.replace("<item>","<!-- broken -- comment body --><item>");
  assert.equal(parseFeed(validRss,"openai",now).length,1,
    "well-formed source comments remain compatible");
  assert.deepEqual(parseFeed(badRss,"openai",now),[],
    "an XML comment containing forbidden internal double hyphens invalidates its publisher feed");
  const atom='<feed><entry><title>Official research with measured model evaluation results</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official research documents reproducible methods, limitations and technical results.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/verified-report"/></entry></feed>';
  assert.equal(parseFeed(atom.replace("<entry>","<!-- real comment --><entry>"),"google",now).length,1);
  assert.deepEqual(parseFeed(atom.replace("<entry>","<!-- invalid -- comment --><entry>"),"google",now),[],
    "malformed Atom source comments cannot be ignored to fabricate independent evidence");
  let modelCalls=0;
  const fetchImpl=async url=>{
    if(url===feeds[0].url)return rssResponse(rss,url);
    if(url===feeds[1].url)return rssResponse(badRss.replace(data[0].url,data[1].url),url);
    modelCalls++;throw Error("MODEL_CALLED_WITH_MALFORMED_OFFICIAL_FEED");
  };
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
  assert.equal(modelCalls,0,"a malformed comment can never unlock a metered AI call");
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
}));


test("XML self-closing slash must immediately precede > in RSS and Atom publisher evidence",()=>tmp(async root=>{
  const rss=item(data[0].url);
  const validRss=rss.replace("<item>","<item><extension />");
  const invalidRss=rss.replace("<item>","<item><extension/ >");
  assert.equal(parseFeed(validRss,"openai",now).length,1,
    "XML permits spaces before the slash in an otherwise valid empty element");
  assert.deepEqual(parseFeed(invalidRss,"openai",now),[],
    "the slash and closing angle bracket of an XML empty element must be adjacent");

  const atom='<feed><entry><title>Official AI research with validated technical findings</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official research describes measured technical findings with methods and limitations.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/verified-selfclosing"/></entry></feed>';
  assert.equal(parseFeed(atom.replace("<entry>","<entry><extension />"),"google",now).length,1,
    "a valid Atom empty element must stay accepted");
  assert.deepEqual(parseFeed(atom.replace("<entry>","<entry><extension/ >"),"google",now),[],
    "malformed Atom empty elements must not authenticate the entire publisher feed");

  let aiCalls=0;
  const fetchImpl=async url=>{
    if(url===feeds[0].url)return rssResponse(rss,url);
    if(url===feeds[1].url)return rssResponse(invalidRss.replace(data[0].url,data[1].url),url);
    aiCalls++;throw Error("AI_CALLED_AFTER_MALFORMED_EMPTY_ELEMENT");
  };
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
  assert.equal(aiCalls,0,"malformed second publisher cannot trigger any provider request");
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before,
    "a rejected feed cannot mutate the canonical publication store");
}));


test("XML CDATA may exist inside an element, never before or after the official feed root",()=>tmp(async root=>{
  const rss=item(data[0].url);
  const validRss=rss.replace("<description>","<description><![CDATA[")
    .replace("</description>","]]></description>");
  assert.equal(parseFeed(validRss,"openai",now).length,1,
    "legitimate RSS CDATA inside the description must remain accepted");
  for(const invalid of [
    "<![CDATA[untrusted outside-root prefix]]>"+rss,
    rss+"<![CDATA[untrusted outside-root suffix]]>"
  ]){
    assert.deepEqual(parseFeed(invalid,"openai",now),[],
      "a publisher document with CDATA outside its root is not well-formed XML");
  }

  const atom='<feed><entry><title>Official AI research with measured evaluation results</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary><![CDATA[Official research covers verified testing results, methods and limitations.]]></summary>'+
    '<link rel="alternate" href="https://blog.google/ai/cdata-root-check"/></entry></feed>';
  assert.equal(parseFeed(atom,"google",now).length,1,
    "legitimate Atom CDATA inside the summary must remain accepted");
  for(const invalid of [
    "<![CDATA[untrusted outside-root prefix]]>"+atom,
    atom+"<![CDATA[untrusted outside-root suffix]]>"
  ]){
    assert.deepEqual(parseFeed(invalid,"google",now),[],
      "CDATA outside the Atom feed root cannot authenticate official source metadata");
  }

  let modelCalls=0;
  const fetchImpl=async url=>{
    if(url===feeds[0].url)return rssResponse(rss,url);
    if(url===feeds[1].url)return rssResponse(
      "<![CDATA[forged outside-root evidence]]>"+item(data[1].url),url);
    modelCalls++;throw Error("MODEL_CALLED_WITH_MALFORMED_CDATA_OUTSIDE_ROOT");
  };
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
  assert.equal(modelCalls,0,"an invalid second publisher must never trigger AI requests");
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before,
    "invalid outside-root CDATA must not change published content");
}));


test("raw ampersands and unknown entities cannot authenticate official XML feed sources",()=>tmp(async root=>{
  const rss=item(data[0].url);
  const good=rss.replace(data[0].url,data[0].url+"?a=1&amp;b=2");
  const parsed=parseFeed(good,"openai",now);
  assert.equal(parsed.length,1,"predefined XML amp entity remains allowed");
  assert.equal(parsed[0].url,data[0].url+"?a=1&b=2",
    "escaped ampersands in official article links decode correctly");
  assert.equal(parseFeed(rss.replace(data[0].url,data[0].url+"?a=1&b=2"),"openai",now).length,0,
    "raw ampersands make XML article permalinks malformed");
  assert.equal(parseFeed(rss.replace("Official announcement","Official &unknown; announcement"),"openai",now).length,0,
    "undeclared entity references make publisher XML malformed");
  assert.equal(parseFeed(rss.replace("<item>","<item note='raw & bad'>"),"openai",now).length,0,
    "raw ampersands in quoted XML attributes remain invalid");
  assert.equal(parseFeed(rss.replace("<item>","<item note='valid &amp; quoted'>"),"openai",now).length,1,
    "properly escaped attribute values remain valid");

  const atom='<feed><entry><title>Official AI inference research findings and benchmarks</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official research explains test setup, measured findings and limitations.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/valid?x=1&amp;y=2"/></entry></feed>';
  assert.equal(parseFeed(atom,"google",now).length,1);
  assert.equal(parseFeed(atom.replace("&amp;","&"),"google",now).length,0,
    "Atom attribute links cannot use unescaped ampersands");

  let aiCalls=0;
  const fetchImpl=async url=>{
    if(url===feeds[0].url)return rssResponse(rss,url);
    if(url===feeds[1].url)return rssResponse(
      item(data[1].url).replace("Official announcement","Official &unbound; announcement"),url);
    aiCalls++;throw Error("AI_CALLED_ON_MALFORMED_XML_REFERENCE");
  };
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
  assert.equal(aiCalls,0,"an invalid second publisher cannot unlock paid provider calls");
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
}));


test("out-of-range XML numeric character references never validate official publisher evidence",()=>tmp(async root=>{
  const rss=item(data[0].url);
  assert.equal(parseFeed(rss,"openai",now).length,1,"genuine RSS remains valid");
  for(const reference of ["&#0;","&#x0;","&#x1F;","&#xD800;","&#55296;","&#xFFFE;","&#x110000;"]){
    const invalid=rss.replace("Official announcement","Official "+reference+" announcement");
    assert.deepEqual(parseFeed(invalid,"openai",now),[],
      "invalid Unicode or XML 1.0 code point "+reference+" must reject the entire source");
    assert.deepEqual(parseFeed(rss.replace("<item>","<item note='bad "+reference+"'>"),"openai",now),[],
      "invalid XML character reference in an attribute must reject the document");
  }
  assert.equal(parseFeed(rss.replace("Official announcement","Official &#65; announcement"),"openai",now).length,1,
    "valid decimal XML character reference must still pass");
  assert.equal(parseFeed(rss.replace("Official announcement","Official &#x1F642; announcement"),"openai",now).length,1,
    "valid supplementary-plane XML character reference must still pass");

  const atom='<feed><entry><title>Official AI research with reproducible technical evidence</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official research provides measured evidence, methods and detailed limitations.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/charref-validation"/></entry></feed>';
  assert.equal(parseFeed(atom,"google",now).length,1,"valid Atom control remains accepted");
  assert.deepEqual(parseFeed(atom.replace("measured evidence","measured &#x110000; evidence"),"google",now),[],
    "Atom source with an out-of-range code point must be rejected");

  let aiCalls=0;
  const fetchImpl=async url=>{
    if(url===feeds[0].url)return rssResponse(rss,url);
    if(url===feeds[1].url)return rssResponse(item(data[1].url)
      .replace("Official announcement","Official &#xD800; announcement"),url);
    aiCalls++;throw Error("AI_CALLED_ON_INVALID_NUMERIC_XML_REFERENCE");
  };
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
  assert.equal(aiCalls,0,"invalid numeric character references cannot unlock AI calls");
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
}));


test("literal XML 1.0 forbidden characters must invalidate complete RSS and Atom feeds",()=>tmp(async root=>{
  const rss=item(data[0].url);
  const atom='<feed><entry><title>Official AI research with reproducible technical evidence</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official research provides measured evidence, methods and detailed limitations.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/xml-literal-char-validation"/></entry></feed>';
  assert.equal(parseFeed(rss,"openai",now).length,1,"valid RSS baseline");
  assert.equal(parseFeed(atom,"google",now).length,1,"valid Atom baseline");
  for(const character of ["\u0000","\u0001","\u000b","\u001f","\uFFFE","\uFFFF","\uD800","\uDC00"]){
    for(const malformed of [
      rss.replace("Official announcement","Official "+character+" announcement"),
      rss.replace("<item>","<item note='bad "+character+"'>"),
      rss.replace("<item>","<!-- bad "+character+" -->"+"<item>"),
      rss.replace("Official announcement","<![CDATA[Official "+character+" announcement]]>")
    ]){
      assert.deepEqual(parseFeed(malformed,"openai",now),[],
        "raw XML-forbidden code point cannot authenticate an RSS item");
    }
    assert.deepEqual(parseFeed(atom.replace("measured evidence","measured "+character+" evidence"),"google",now),[],
      "raw XML-forbidden code point cannot authenticate an Atom entry");
  }
  assert.equal(parseFeed(rss.replace("Official announcement","Official \u0009\u000a\u000d announcement"),"openai",now).length,1,
    "XML 1.0 TAB, LF and CR remain legal literal characters");
  assert.equal(parseFeed(atom.replace("measured evidence","measured \u{1F642} evidence"),"google",now).length,1,
    "valid supplementary-plane Unicode in the Atom body remains legal");

  let aiCalls=0;
  const fetchImpl=async url=>{
    if(url===feeds[0].url)return rssResponse(rss,url);
    if(url===feeds[1].url)return rssResponse(item(data[1].url)
      .replace("Official announcement","Official \u0000 announcement"),url);
    aiCalls++;throw Error("AI_CALLED_WITH_INVALID_RAW_XML_CHARACTER");
  };
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
  assert.equal(aiCalls,0,"malformed publisher XML never unlocks provider invocation");
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
}));


test("CDATA close token in ordinary XML text cannot authenticate official publisher feeds",()=>tmp(async root=>{
  const rss=item(data[0].url);
  const atom='<feed><entry><title>Official AI research with reproducible evidence</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official research provides measured evidence, methods and detailed limitations.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/cdata-terminator-validation"/></entry></feed>';
  assert.equal(parseFeed(rss,"openai",now).length,1,"valid RSS baseline");
  assert.equal(parseFeed(atom,"google",now).length,1,"valid Atom baseline");
  for(const invalid of [
    rss.replace("Official announcement","Official ]]> announcement"),
    rss.replace("Two-source inference","Two-source ]]> inference"),
    rss.replace("</title><link>","</title>]]><link>"),
    rss.replace("<item>","<item>]]>"),
    atom.replace("measured evidence","measured ]]> evidence")
  ]){
    assert.deepEqual(parseFeed(invalid,invalid.startsWith("<feed>")?"google":"openai",now),[],
      "the CDATA closing sequence is forbidden outside real CDATA");
  }
  assert.equal(parseFeed(rss.replace("Official announcement","Official ]]&gt; announcement"),"openai",now).length,1,
    "escaped greater-than in ordinary XML text is legal");
  assert.equal(parseFeed(rss.replace("<item>","<item><!-- genuine comment ]]> remains legal -->"),"openai",now).length,1,
    "the same sequence inside an XML comment is not character data");
  assert.equal(parseFeed(rss.replace("Official announcement","<![CDATA[Official ]]]]><![CDATA[> announcement]]>"),"openai",now).length,1,
    "adjacent well-formed CDATA sections must remain valid");

  let aiCalls=0;
  const fetchImpl=async url=>{
    if(url===feeds[0].url)return rssResponse(rss,url);
    if(url===feeds[1].url)return rssResponse(atom.replace("measured evidence","measured ]]> evidence"),url);
    aiCalls++;throw Error("AI_CALLED_WITH_UNTRUSTED_XML_CDATA_CLOSE_TOKEN");
  };
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
  assert.equal(aiCalls,0,"malformed feed cannot unlock a provider call");
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
}));


test("Reserved or malformed XML processing instructions cannot count as official publisher feeds",()=>tmp(async root=>{
 const actual=item(data[0].url);
 const illegal=[
  ["reserved XML declaration inside RSS root",'<?xml version="1.0"?>'],
  ["mixed-case reserved XML PI inside RSS root",'<?XML version="1.0"?>'],
  ["empty XML PI target",'<??>'],
  ["whitespace before XML PI target",'<? bogus?>'],
  ["invalid character in XML PI target",'<?bad@target?>']
 ];
 for(const [name,pi] of illegal){
   const forged=actual.replace("<rss>","<rss>"+pi);
   assert.equal(parseFeed(forged,"openai",now).length,0,name);
 }
 const validProlog='<?xml version="1.0" encoding="UTF-8"?>'+actual;
 assert.equal(parseFeed(validProlog,"openai",now).length,1,
   "genuine first-position XML declaration must remain supported");
 const validStylesheet='<?xml-stylesheet type="text/xsl" href="style.xsl"?>'+actual;
 assert.equal(parseFeed(validStylesheet,"openai",now).length,1,
   "legal non-reserved processing instruction must remain supported");
 const bogus=actual.replace("<rss>",'<rss><?xml version="1.0"?>');
 const original=await fs.readFile(join(root,"content.json"),"utf8");
 let aiCalls=0;
 const fetchImpl=async url=>{
   if(url===feeds[0].url)return rssResponse(bogus,url);
   if(url===feeds[1].url)return rssResponse(item(data[1].url),url);
   aiCalls++;throw Error("AI_MUST_NOT_RUN");
 };
 await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/,
   "malformed feed plus one valid feed must not satisfy publisher quorum");
 assert.equal(aiCalls,0,"do not invoke any provider on malformed source quorum");
 assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),original);
}));


test("Atom link identity must come from real href/rel attributes, not quoted metadata",()=>tmp(async root=>{
 const atom=link=>'<feed><entry>'+
   '<title>Verified official AI model methodology and independent evaluation findings</title>'+
   '<summary>The official technical evaluation details methods limitations and verified results in the research article.</summary>'+
   '<updated>2026-10-17T23:00:00Z</updated>'+link+'</entry></feed>';
 const article='https://blog.google/ai/verified-official-study';
 const invalid=[
   ["rel=self with rel=alternate hidden in title",
      '<link rel="self" title="rel='+"'alternate'"+'" href="'+article+'"/>'],
   ["rel=enclosure with rel=alternate hidden in description",
      '<link rel="enclosure" description="quoted rel='+"'alternate'"+'" href="'+article+'"/>'],
   ["data-href is not an Atom link href",
      '<link rel="alternate" data-href="'+article+'"/>'],
   ["title text containing href= is not an Atom link href",
      '<link rel="alternate" title="href='+"'"+article+"'"+'"/>']
 ];
 for(const [reason,link] of invalid){
   assert.equal(parseFeed(atom(link),"google",now).length,0,reason);
 }
 const accepted=[
   '<link rel="alternate" type="text/html" href="'+article+'"/>',
   '<link type="text/html" href="'+article+'"/>'
 ];
 for(const link of accepted){
   const valid=parseFeed(atom(link),"google",now);
   assert.equal(valid.length,1,"real Atom article href remains accepted");
   assert.equal(valid[0].url,article);
 }
 const original=await fs.readFile(join(root,"content.json"),"utf8");
 let aiCalls=0;
 const fetchImpl=async url=>{
   if(url===feeds[0].url)return rssResponse(item(data[0].url),url);
   if(url===feeds[1].url)return rssResponse(atom(invalid[0][1]),url);
   aiCalls++;throw Error("AI_MUST_NOT_RUN");
 };
 assert.deepEqual(await publish({root,fetchImpl,env,now,feeds}),{status:"noop"},
   "forged rel attribute must never create two publisher story quorum");
 assert.equal(aiCalls,0,"AI provider must not be called for forged source");
 assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),original);
}));


test("Atom attributes are XML-case-sensitive and uppercase shadow attributes cannot spoof provenance",()=>tmp(async root=>{
 const article="https://blog.google/ai/official-technical-review";
 const atom=attrs=>'<feed><entry>'+
   '<title>Official technical review of reproducible AI methodology</title>'+
   '<summary>The official research report summarizes independent evaluations, methodology and important known limitations.</summary>'+
   '<updated>2026-10-17T23:00:00Z</updated>'+
   '<link '+attrs+'/></entry></feed>';
 const bad=[
  ["uppercase REL overrides true rel=enclosure",
   'rel="enclosure" REL="alternate" href="'+article+'"'],
  ["uppercase HREF shadows true off-origin href",
   'rel="alternate" href="https://untrusted.example/forged" HREF="'+article+'"'],
  ["uppercase HREF alone is not Atom href",
   'rel="alternate" HREF="'+article+'"'],
  ["mixed-case HrEf alone is not Atom href",
   'rel="alternate" HrEf="'+article+'"'],
 ];
 for(const [reason,attrs] of bad){
   assert.equal(parseFeed(atom(attrs),"google",now).length,0,reason);
 }
 const good=parseFeed(atom('rel="alternate" href="'+article+'"'),"google",now);
 assert.equal(good.length,1,"the exact lower-case official Atom attributes must remain valid");
 assert.equal(good[0].url,article);
 const actualFallback=parseFeed(atom('REL="alternate" href="'+article+'"'),"google",now);
 assert.equal(actualFallback.length,1,"without a lowercase rel, Atom defaults to alternate");
 const original=await fs.readFile(join(root,"content.json"),"utf8");
 let aiCalls=0;
 const fetchImpl=async url=>{
   if(url===feeds[0].url)return rssResponse(item(data[0].url),url);
   if(url===feeds[1].url)return rssResponse(atom(bad[0][1]),url);
   aiCalls++;throw Error("AI_MUST_NOT_RUN");
 };
 assert.deepEqual(await publish({root,fetchImpl,env,now,feeds}),{status:"noop"});
 assert.equal(aiCalls,0,"uppercase shadow attributes cannot unlock AI generation");
 assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),original);
}));


test("Legitimate quoted greater-than in XML attributes never contaminates official entry metadata",()=>{
 const expectedUrl="https://openai.com/news/quoted-attribute-article";
 const rss='<rss><channel><item>'+
   '<title note="trusted > preview">Official AI inference evaluation with verified methodology</title>'+
   '<link context="article > publisher">'+expectedUrl+'</link>'+
   '<pubDate origin="fresh > current">'+date+'</pubDate>'+
   '<description note="methods > summary">The official announcement reports reproducible AI experiments, measured findings and meaningful methodological limitations.</description>'+
   '</item></channel></rss>';
 const realRss=parseFeed(rss,"openai",now);
 assert.equal(realRss.length,1,"valid XML attributes must not silently delete official RSS items");
 assert.equal(realRss[0].title,"Official AI inference evaluation with verified methodology");
 assert.equal(realRss[0].url,expectedUrl);
 assert.equal(realRss[0].summary,
   "The official announcement reports reproducible AI experiments, measured findings and meaningful methodological limitations.");
 assert.equal(realRss[0].publishedAt,new Date(date).toISOString());
 const atom='<feed><entry>'+
   "<title origin='research > early'>Verified AI model safety evaluation from official publisher</title>"+
   '<summary note="tests > estimates">The official study explains independent testing, reproducible results, design choices and known limitations.</summary>'+
   '<updated origin="utc > local">2026-10-17T23:00:00Z</updated>'+
   '<link rel="alternate" title="article > snippet" href="https://blog.google/ai/official-quoted-attributes"/>'+
   '</entry></feed>';
 const realAtom=parseFeed(atom,"google",now);
 assert.equal(realAtom.length,1,"valid Atom metadata with quoted greater-than must remain source evidence");
 assert.equal(realAtom[0].title,"Verified AI model safety evaluation from official publisher");
 assert.equal(realAtom[0].summary,
   "The official study explains independent testing, reproducible results, design choices and known limitations.");
 assert.equal(realAtom[0].url,"https://blog.google/ai/official-quoted-attributes");
 assert.equal(realAtom[0].publishedAt,"2026-10-17T23:00:00.000Z");
});


test("XML numeric permalink references decode exactly once for RSS and Atom source identity",()=>{
 const expectedRss="https://openai.com/news/technical-study?a=1&b=2";
 const rss=url=>'<rss><channel><item>'+
   '<title>Official AI evaluation research reports transparent methodology</title>'+
   '<link>'+url+'</link><pubDate>'+date+'</pubDate>'+
   '<description>Official publication describes independent experiments, reproducible measurements and limitations of research.</description>'+
   '</item></channel></rss>';
 for(const [name,permalink] of [
  ["decimal", "https://openai.com/news/technical-study?a=1&#38;b=2"],
  ["hexadecimal", "https://openai.com/news/technical-study?a=1&#x26;b=2"],
  ["predefined", "https://openai.com/news/technical-study?a=1&amp;b=2"]
 ]){
   const actual=parseFeed(rss(permalink),"openai",now);
   assert.equal(actual.length,1,name+" RSS remains an official article");
   assert.equal(actual[0].url,expectedRss,name+" RSS source URL identity must be decoded");
 }
 const expectedAtom="https://blog.google/ai/technical-study?a=1&b=2";
 const atom=url=>'<feed><entry>'+
  '<title>Official AI evaluation research confirms independent technical findings</title>'+
  '<summary>Official report describes research methods, reproducible evaluations and important limitations.</summary>'+
  '<updated>2026-10-17T23:00:00Z</updated>'+
  '<link rel="alternate" href="'+url+'"/></entry></feed>';
 for(const [name,permalink] of [
  ["decimal", "https://blog.google/ai/technical-study?a=1&#38;b=2"],
  ["hexadecimal", "https://blog.google/ai/technical-study?a=1&#x26;b=2"],
  ["predefined", "https://blog.google/ai/technical-study?a=1&amp;b=2"]
 ]){
   const actual=parseFeed(atom(permalink),"google",now);
   assert.equal(actual.length,1,name+" Atom remains an official article");
   assert.equal(actual[0].url,expectedAtom,name+" Atom source URL identity must be decoded");
 }
 // The literal URL substring "&#38;" was encoded as &amp;#38; in XML.
 // Decoding XML a second time would fabricate an extra URL query argument.
 const literal="https://openai.com/news/technical-study?a=1&#38;b=2";
 const escapedNumeric=rss(literal.replace("&#38;","&amp;#38;"));
 assert.equal(parseFeed(escapedNumeric,"openai",now)[0]?.url,literal,
   "a literal escaped numeric-looking sequence must not be double-decoded");
 const cdata=rss('<![CDATA['+expectedRss+']]>');
 assert.equal(parseFeed(cdata,"openai",now)[0]?.url,expectedRss,
   "CDATA literal ampersands must stay intact");
});

test("XML RSS/Atom element names are case-sensitive for publisher evidence and quorum",()=>tmp(async root=>{
  const validRss=item(data[0].url);
  const atom='<feed><entry><title>Official verified AI research announcement</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<summary>Official research presents evaluated findings and methodology limitations.</summary>'+
    '<link rel="alternate" href="https://blog.google/ai/genuine-case-sensitive-entry"/></entry></feed>';
  assert.equal(parseFeed(validRss,"openai",now).length,1);
  assert.equal(parseFeed(atom,"google",now).length,1);
  for(const bad of [
    validRss.replace("<rss>","<RSS>").replace("</rss>","</RSS>"),
    validRss.replace("<item>","<ITEM>").replace("</item>","</ITEM>"),
    validRss.replace("<title>","<TITLE>").replace("</title>","</TITLE>"),
    validRss.replace("<pubDate>","<PUBDATE>").replace("</pubDate>","</PUBDATE>")
  ]) assert.deepEqual(parseFeed(bad,"openai",now),[],
    "non-RSS uppercase element must not be recognized as the official RSS element");
  for(const bad of [
    atom.replace("<feed>","<FEED>").replace("</feed>","</FEED>"),
    atom.replace("<entry>","<ENTRY>").replace("</entry>","</ENTRY>"),
    atom.replace("<title>","<TITLE>").replace("</title>","</TITLE>"),
    atom.replace("<link ","<LINK ")
  ]) assert.deepEqual(parseFeed(bad,"google",now),[],
    "XML case differences cannot create a valid Atom article");
  let modelCalls=0;
  const fetchImpl=async url=>{
    if(url===feeds[0].url)return rssResponse(validRss,url);
    if(url===feeds[1].url)return rssResponse(
      validRss.replace(data[0].url,data[1].url).replace("<rss>","<RSS>").replace("</rss>","</RSS>"),url);
    modelCalls++;throw Error("AI_CALLED_WITH_INVALID_XML_CASE");
  };
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),/FEED_QUORUM_UNAVAILABLE/);
  assert.equal(modelCalls,0);
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
}));

test("Atom relation token must match registered lowercase alternate without case folding",()=>tmp(async root=>{
 const good='<feed><entry><title>Official AI evaluation and research methodology</title>'+
  '<updated>2026-10-17T23:00:00Z</updated>'+
  '<summary>Official report describes technical experiments, verified methods and important limitations.</summary>'+
  '<link rel="alternate" href="https://blog.google/ai/genuine-alternate"/></entry></feed>';
 assert.equal(parseFeed(good,"google",now).length,1,"registered alternate is recognized");
 const implicit=good.replace('rel="alternate" ','');
 assert.equal(parseFeed(implicit,"google",now).length,1,"missing rel defaults to alternate by RFC 4287");
 for(const nonAlternate of ['ALTERNATE','Alternate','alternate2','self']){
   const spoof=good.replace('rel="alternate"','rel="'+nonAlternate+'"');
   assert.deepEqual(parseFeed(spoof,"google",now),[],
     "distinct rel value must not be converted into the registered alternate relation");
 }
 const forged=good.replace('rel="alternate"','rel="ALTERNATE"');
 const before=await fs.readFile(join(root,"content.json"),"utf8");
 let modelCalls=0;
 const fetchImpl=async url=>{
  if(url===feeds[0].url)return rssResponse(item(data[0].url),url);
  if(url===feeds[1].url)return rssResponse(forged,url);
  modelCalls++;throw Error("AI_CALLED_ON_UNREGISTERED_ATOM_RELATION");
 };
 assert.deepEqual(await publish({root,fetchImpl,env,now,feeds}),{status:"noop"});
 assert.equal(modelCalls,0,"unregistered Atom rel cannot unlock a paid model request");
 assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
}));

test("RSS text link and Atom href permalink must never cross-contaminate feed formats",()=>tmp(async root=>{
 const rss='<rss><channel><item><title>Official research evaluation update with independent methods</title>'+
  '<link>https://openai.com/news/genuine-rss-article</link><pubDate>'+date+'</pubDate>'+
  '<description>Official source documents independent experiments and verified limitations in detail.</description>'+
  '</item></channel></rss>';
 const atomStart='<feed><entry><title>Official model research with reproducible methodology</title>'+
  '<updated>2026-10-17T23:00:00Z</updated>'+
  '<summary>Official source covers independent research findings, methods and detailed limitations.</summary>';
 const actual='https://blog.google/ai/authentic-href';
 const fake='https://blog.google/ai/forged-link-text';
 const goodAtom=atomStart+'<link rel="alternate" href="'+actual+'"/></entry></feed>';
 assert.equal(parseFeed(rss,"openai",now)[0]?.url,
   'https://openai.com/news/genuine-rss-article');
 assert.equal(parseFeed(goodAtom,"google",now)[0]?.url,actual);
 for(const invalid of [
   atomStart+'<link>'+fake+'</link></entry></feed>',
   atomStart+'<link rel="self">'+fake+'</link></entry></feed>',
   atomStart+'<link rel="self" href="'+actual+'">'+fake+'</link></entry></feed>'
 ]){
   assert.deepEqual(parseFeed(invalid,"google",now),[],
     "Atom link text or self-relation cannot become an alternate article URL");
 }
 const misleadingAtom=atomStart+'<link rel="self" href="'+fake+'">'+fake+'</link>'+
   '<link rel="alternate" href="'+actual+'"/></entry></feed>';
 assert.equal(parseFeed(misleadingAtom,"google",now)[0]?.url,actual,
   "an actual Atom alternate href must win over textual content of self link");
 const fauxRss='<rss><channel><item><title>RSS sample with non-RSS Atom-only link</title>'+
  '<link rel="alternate" href="https://openai.com/news/not-rss-text"/><pubDate>'+date+'</pubDate>'+
  '<description>Official research mentions technical methods, results and limitations.</description>'+
  '</item></channel></rss>';
 assert.deepEqual(parseFeed(fauxRss,"openai",now),[],
   "RSS item must not silently use Atom href fallback in place of its RSS link text");
 const before=await fs.readFile(join(root,"content.json"),"utf8");
 let modelCalls=0;
 const fetchImpl=async url=>{
   if(url===feeds[0].url)return rssResponse(rss,url);
   if(url===feeds[1].url)return rssResponse(atomStart+'<link>'+fake+'</link></entry></feed>',url);
   modelCalls++;throw Error("AI_CALLED_WITH_ATOM_LINK_TEXT_PROVENANCE");
 };
 assert.deepEqual(await publish({root,fetchImpl,env,now,feeds}),{status:"noop"});
 assert.equal(modelCalls,0,"false second publisher cannot invoke a model");
 assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
}));

test("XML 1.0 only permits S whitespace at document boundaries and XML attribute separators",()=>{
  const validRss=item("https://openai.com/news/xml-lexical-space");
  const validAtom='<feed><entry><title>Official AI technology research results and limitations</title>'+
    '<updated>2026-10-17T23:00:00Z</updated>'+
    '<link rel="alternate" href="https://blog.google/ai/xml-lexical-space"/>'+
    '<summary>Official technology research reports verifiable measurements and their limitations.</summary>'+
    '</entry></feed>';
  assert.equal(parseFeed(validRss,"openai",now).length,1,"ordinary RSS still works");
  assert.equal(parseFeed(validAtom,"google",now).length,1,"ordinary Atom still works");
  assert.equal(parseFeed("\uFEFF"+validRss,"openai",now).length,1,
    "one true leading Unicode BOM remains legitimate");
  assert.equal(parseFeed("\uFEFF"+validAtom,"google",now).length,1,
    "Atom also permits one initial Unicode BOM");
  assert.equal(parseFeed(" \t"+validRss+"\r\n","openai",now).length,1,
    "XML 1.0 S whitespace is allowed");
  for(const [label,space] of [["NBSP","\u00A0"],["FIGURE","\u2007"],
      ["NARROW_NBSP","\u202F"],["MID_STREAM_BOM","\uFEFF"]]){
    for(const [kind,document,source] of [["RSS",validRss,"openai"],["ATOM",validAtom,"google"]]){
      if(label!=="MID_STREAM_BOM"){
        assert.deepEqual(parseFeed(space+document,source,now),[],
          kind+" must reject non-XML "+label+" before the document element");
      }
      assert.deepEqual(parseFeed(document+space,source,now),[],
        kind+" must reject non-XML "+label+" after the document element");
    }
  }
  assert.deepEqual(parseFeed(" \uFEFF"+validRss,"openai",now),[],
    "BOM is a signature only at byte-zero, not after whitespace");
  assert.deepEqual(parseFeed(validRss.replace("<rss>","<rss\u00A0>"),"openai",now),[],
    "non-XML whitespace must not terminate an XML tag name");
  assert.deepEqual(parseFeed(validAtom.replace('<link rel=', '<link\u00A0rel='),"google",now),[],
    "non-XML whitespace must not separate XML attributes");
});

test("malformed XML prologs cannot count as readable independent publishers",()=>tmp(async root=>{
  const valid=item(data[0].url);
  const legal='<?xml version="1.0" encoding="UTF-8"?>'+valid;
  assert.equal(parseFeed(legal,"openai",now).length,1,
    "official XML 1.0 declaration remains accepted");
  const forged=[
    ["reserved uppercase XML PI",'<?XML version="1.0"?>'+valid],
    ["XML 2.0 unsupported prolog",'<?xml version="2.0"?>'+valid]
  ];
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  for(const [why,xml] of forged){
    assert.deepEqual(parseFeed(xml,"openai",now),[],why+" is not well-formed source XML");
    const warnings=[];
    let aiCalls=0;
    const fetchImpl=async url=>{
      if(url===feeds[0].url)return rssResponse(xml,url);
      if(url===feeds[1].url)return rssResponse(item(data[1].url),url);
      aiCalls++;throw Error("MODEL_MUST_NOT_BE_CALLED");
    };
    await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),
      /FEED_QUORUM_UNAVAILABLE/,
      why+" must not raise readable publisher count to two");
    assert.equal(aiCalls,0,why+" must not trigger metered model");
    assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before,
      why+" must not mutate content.json");
  }
}));

test("XML 1.0 declaration grammar rejects duplicated, reordered and malformed attributes before source quorum",()=>tmp(async root=>{
  const valid=item(data[0].url);
  const good=[
    valid,
    '<?xml version="1.0"?>'+valid,
    '<?xml version="1.0" encoding="UTF-8"?>'+valid,
    "<?xml version='1.0' standalone='yes'?>"+valid,
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>'+valid,
    "\uFEFF"+'<?xml version="1.0"?>'+valid
  ];
  for(const xml of good){
    assert.equal(parseFeed(xml,"openai",now).length,1,
      "XML 1.0 standard valid declaration must keep legitimate article evidence");
  }
  const bad=[
    ["duplicate encoding",'<?xml version="1.0" encoding="UTF-8" encoding="UTF-16"?>'+valid],
    ["duplicate standalone",'<?xml version="1.0" standalone="yes" standalone="no"?>'+valid],
    ["wrong attribute order",'<?xml version="1.0" standalone="yes" encoding="UTF-8"?>'+valid],
    ["unregistered standalone value",'<?xml version="1.0" standalone="maybe"?>'+valid],
    ["invalid encoding name",'<?xml version="1.0" encoding="9UTF-8"?>'+valid],
    ["XML declaration after S whitespace",' \t<?xml version="1.0"?>'+valid],
    ["non XML S between xml and version",'<?xml\u00A0version="1.0"?>'+valid]
  ];
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  for(const [reason,xml] of bad){
    assert.deepEqual(parseFeed(xml,"openai",now),[],reason+" cannot be official evidence");
  }
  // A malformed feed plus one valid independent feed cannot silently
  // become a healthy two-publisher NOOP, nor invoke a metered model.
  for(const [reason,xml] of [bad[0],bad[3],bad[5]]){
    let modelCalls=0;
    const fetchImpl=async url=>{
      if(url===feeds[0].url)return rssResponse(xml,url);
      if(url===feeds[1].url)return rssResponse(item(data[1].url),url);
      modelCalls++;throw Error("NO_MODEL_FOR_INVALID_XML_DECLARATION");
    };
    await assert.rejects(()=>publish({root,fetchImpl,env,now,feeds}),
      /FEED_QUORUM_UNAVAILABLE/,reason+" must not count healthy source quorum");
    assert.equal(modelCalls,0,"invalid prolog cannot cause paid model traffic");
    assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
  }
}));

const officialAnnouncement=()=>{
  const d=structuredClone(draft);
  d.reportingMode="official-announcement";
  d.sourceIds=["openai-1"];
  d.claims=d.claims.map(c=>({...c,sourceIds:["openai-1"]}));
  const labels={vi:"Theo công bố của OpenAI.",en:"According to OpenAI.",es:"Según OpenAI."};
  for(const l of ["vi","en","es"])d.editions[l].dek=labels[l]+" "+d.editions[l].dek;
  return d;
};
const announcementReview=()=>({
  pass:true,claimsSupported:true,localesValid:true,attributionValid:true,
  supportedSourceIds:["openai-1"],supportedClaims:[0,1],
  claimSourceEvidence:[0,1].map(index=>({index,sourceIds:["openai-1"],
    excerpts:[{sourceId:"openai-1",text:officialExcerpt}]}))
});

test("Attributed official announcement accepts one authentic publisher while legacy reporting stays strict",()=>{
  const d=officialAnnouncement();
  assert.equal(validateDraft(d,data).length,1);
  verifyReview(announcementReview(),d,[data[0]]);
  const old=structuredClone(d);delete old.reportingMode;
  assert.throws(()=>validateDraft(old,data),/DRAFT_SOURCES_INSUFFICIENT/);
  const untrusted=[{...data[0],url:"https://untrusted.example/claim"}];
  assert.throws(()=>validateDraft(d,untrusted),/OFFICIAL_SOURCE_UNVERIFIED/);
  for(const l of ["vi","en","es"]){
    const missing=structuredClone(d);missing.editions[l].dek=edition(l).dek;
    assert.throws(()=>validateDraft(missing,data),/OFFICIAL_ATTRIBUTION_MISSING/);
  }
  const rejected=announcementReview();rejected.attributionValid=false;
  assert.throws(()=>verifyReview(rejected,d,[data[0]]),/REVIEW_ATTRIBUTION_UNVERIFIED/);
  const forged=announcementReview();forged.claimSourceEvidence[0].excerpts[0].text="Fabricated quotation unrelated to the official article text";
  assert.throws(()=>verifyReview(forged,d,[data[0]]),/REVIEW_EXCERPTS_UNVERIFIED/);
});

test("Official announcement mode reads full official article before writer and stages three attributed locales",()=>tmp(async root=>{
  const d=officialAnnouncement(),r=announcementReview();
  const calls=[];
  const base=mockFetch({replyDraft:d,replyReview:r});
  const fetchImpl=async(url,opts)=>{
    calls.push(url);
    if(url===data[0].url)return new Response(
      "<html><article><h1>"+officialTitle+"</h1><p>"+officialExcerpt.repeat(8)+"</p></article></html>",
      {status:200,headers:{"content-type":"text/html"}});
    return base(url,opts);
  };
  const result=await publish({root,fetchImpl,env:{...env,NEWS_REPORTING_MODE:"official-announcement"},now,feeds});
  assert.equal(result.status,"staged");
  assert.ok(calls.indexOf(data[0].url)<calls.indexOf(env.AI_CHAT_COMPLETIONS_URL));
  const story=JSON.parse(await fs.readFile(join(root,"content.json"),"utf8")).articles[0];
  assert.equal(story.reportingMode,"official-announcement");
  assert.equal(story.sources.length,1);
  for(const l of ["vi","en","es"])assert.match(story.editions[l].dek,/OpenAI/);
}));

test("Official announcement mode refuses missing full source text without AI or content mutation",()=>tmp(async root=>{
  let aiCalls=0;
  const before=await fs.readFile(join(root,"content.json"),"utf8");
  const fetchImpl=async url=>{
    if(url===feeds[0].url)return rssResponse(item(data[0].url),url);
    if(url===feeds[1].url)return rssResponse(item(data[1].url),url);
    if(url===data[0].url||url===data[1].url)return new Response("unavailable",{status:503});
    aiCalls++;throw Error("AI_MUST_NOT_RUN_WITHOUT_FULL_ARTICLE");
  };
  const result=await publish({root,fetchImpl,env:{...env,NEWS_REPORTING_MODE:"official-announcement"},now,feeds});
  assert.deepEqual(result,{status:"noop"});
  assert.equal(aiCalls,0);
  assert.equal(await fs.readFile(join(root,"content.json"),"utf8"),before);
}));

test("Actions incident diagnostic identifies provider, feed and cover failure without leaking raw errors",()=>{
  assert.deepEqual(summarizePublishResult(null,new Error("AI_PROVIDER_HTTP_503")),
    {status:"FAILURE",area:"AI_PROVIDER",code:"AI_PROVIDER_HTTP_503"});
  assert.deepEqual(summarizePublishResult(null,new Error("FEED_QUORUM_UNAVAILABLE")),
    {status:"FAILURE",area:"OFFICIAL_SOURCE",code:"FEED_QUORUM_UNAVAILABLE"});
  assert.deepEqual(summarizePublishResult(null,new Error("COVER_ALREADY_EXISTS")),
    {status:"FAILURE",area:"CONTENT_OR_COVER",code:"COVER_ALREADY_EXISTS"});
  assert.deepEqual(summarizePublishResult(null,new Error("path /private/token?q=secret")),
    {status:"FAILURE",area:"PUBLISHER",code:"UNCLASSIFIED_FAILURE"});
});

test("Actions editorial NOOP and staged article cannot be reported as publication success",()=>{
  assert.deepEqual(summarizePublishResult({status:"noop"}),
    {status:"NOOP",area:"EDITORIAL",code:"NO_QUALIFIED_NEW_STORY"});
  assert.deepEqual(summarizePublishResult({status:"staged",slug:"pending-cover"}),
    {status:"STAGED",area:"PUBLICATION",code:"ARTICLE_STAGED_NOT_COMMITTED"});
  assert.deepEqual(summarizePublishResult(undefined),
    {status:"FAILURE",area:"PUBLISHER",code:"UNKNOWN_RUN_OUTCOME"});
});
