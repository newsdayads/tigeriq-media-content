import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {evaluateHourlyPublication} from "./hourly-publication-kpi.mjs";

const at=new Date("2026-10-23T22:20:00.000Z");
const story=(publishedAt="2026-10-23T22:17:50.063Z")=>({
  slug:"verified-story",publishedAt,
  editions:{
    vi:{title:"Tin tức tiếng Việt",dek:"Bản tin có nội dung thật.",
      sections:[{heading:"Thông tin chính",body:"Nội dung tiếng Việt đã được biên tập."}]},
    en:{title:"Verified English story",dek:"A real published article.",
      sections:[{heading:"Key findings",body:"Verified article body in English."}]},
    es:{title:"Noticia verificada en español",dek:"Un artículo con contenido.",
      sections:[{heading:"Hallazgos",body:"Texto verificado en español."}]}
  },
  cover:{generated:true,url:
    "https://raw.githubusercontent.com/newsdayads/tigeriq-media-content/main/covers/verified-story.svg"}
});
// Native backup fires at :47; 22:20Z precedes this hour’s cron tick.
const github={eventName:"schedule",now:new Date("2026-10-23T22:47:00.000Z")};
const cloudflare={eventName:"workflow_dispatch",schedulerOrigin:"cloudflare",
  scheduledHourUtc:"2026-10-23T22:00:00Z",now:at};

test("genuine scheduled hour with no new article fails even if Actions would otherwise be green",()=>{
  for(const attempt of [github,cloudflare]){
    const result=evaluateHourlyPublication({...attempt,store:{articles:[]}});
    assert.equal(result.enforced,true);
    assert.equal(result.passed,false);
    assert.equal(result.code,"MISSED_HOURLY_TARGET_NO_COMMITTED_STORY");
    assert.equal(result.cloudflareNativeEvent,"NOT_VERIFIED_BY_GITHUB_INPUT");
  }
});

test("a real committed article in the same hour passes both scheduled routes",()=>{
  for(const attempt of [github,cloudflare]){
    const result=evaluateHourlyPublication({...attempt,store:{articles:[story()]}});
    assert.equal(result.enforced,true);
    assert.equal(result.passed,true);
    assert.equal(result.code,"COMMITTED_STORY_PRESENT");
    assert.equal(result.hourUtc,"2026-10-23T22:00:00Z");
  }
});

test("headline-only or blank-body edition cannot count as an hourly publication",()=>{
  const complete=story();
  const headlineOnly={...complete,editions:Object.fromEntries(
    ["vi","en","es"].map(lang=>[lang,{title:complete.editions[lang].title}]))};
  const blankSummary={...complete,editions:{...complete.editions,
    en:{...complete.editions.en,dek:"   "}}};
  const missingSections={...complete,editions:{...complete.editions,
    vi:{...complete.editions.vi,sections:[]}}};
  const blankBody={...complete,editions:{...complete.editions,
    es:{...complete.editions.es,sections:[{heading:"Hallazgos",body:"   "}]}}};
  const blankHeading={...complete,editions:{...complete.editions,
    vi:{...complete.editions.vi,sections:[{heading:" ",body:"Real text"}]}}};
  for(const route of [github,cloudflare]){
    for(const invalid of [headlineOnly,blankSummary,missingSections,blankBody,blankHeading]){
      const result=evaluateHourlyPublication({...route,store:{articles:[invalid]}});
      assert.equal(result.passed,false);
      assert.equal(result.committedStoryCount,1);
      assert.equal(result.code,"INCOMPLETE_TRILINGUAL_OR_COVER_PUBLICATION");
    }
  }
});

test("an hour with timestamp but without trilingual editions or its own original cover cannot PASS",()=>{
  const valid=story();
  const invalid=[
    {slug:valid.slug,publishedAt:valid.publishedAt},
    {...valid,editions:{...valid.editions,es:undefined}},
    {...valid,editions:{...valid.editions,vi:{title:"   "}}},
    {...valid,cover:undefined},
    {...valid,cover:{...valid.cover,generated:false}},
    {...valid,cover:{...valid.cover,url:valid.cover.url.replace("verified-story.svg","other-story.svg")}},
    {...valid,slug:"other-story"}
  ];
  for(const route of [github,cloudflare]){
    for(const bad of invalid){
      const result=evaluateHourlyPublication({...route,store:{articles:[bad]}});
      assert.equal(result.passed,false);
      assert.equal(result.committedStoryCount,1);
      assert.equal(result.code,"INCOMPLETE_TRILINGUAL_OR_COVER_PUBLICATION");
      assert.equal(result.cloudflareNativeEvent,"NOT_VERIFIED_BY_GITHUB_INPUT");
    }
  }
});

test("a complete trilingual story plus an incomplete duplicate still fails exactly-one policy",()=>{
  const another={...story("2026-10-23T22:19:00.000Z"),slug:"another-story",cover:null};
  for(const route of [github,cloudflare]){
    const result=evaluateHourlyPublication({...route,store:{articles:[story(),another]}});
    assert.equal(result.passed,false);
    assert.equal(result.committedStoryCount,2);
    assert.equal(result.code,"MULTIPLE_COMMITTED_STORIES_IN_UTC_HOUR");
  }
});

test("two distinct stories in the same UTC hour must fail the exact-one gate for both scheduled routes",()=>{
  const duplicated={articles:[story("2026-10-23T22:17:50.063Z"),
    {...story("2026-10-23T22:19:00.000Z"),slug:"another-verified-story"}]};
  for(const route of [github,cloudflare]){
    const result=evaluateHourlyPublication({...route,store:duplicated});
    assert.equal(result.enforced,true);
    assert.equal(result.passed,false);
    assert.equal(result.code,"MULTIPLE_COMMITTED_STORIES_IN_UTC_HOUR");
    assert.equal(result.committedStoryCount,2);
    assert.equal(result.cloudflareNativeEvent,"NOT_VERIFIED_BY_GITHUB_INPUT");
  }
});

test("normalized impossible February dates cannot fabricate a March publication",()=>{
  // Node Date.parse historically accepts Feb 30 as March 2.
  assert.equal(new Date(Date.parse("2026-02-30T22:17:50Z")).toISOString(),
    "2026-03-02T22:17:50.000Z");
  const input={eventName:"workflow_dispatch",schedulerOrigin:"cloudflare",
    scheduledHourUtc:"2026-03-02T22:00:00Z",now:new Date("2026-03-02T22:47:00Z")};
  const fake=evaluateHourlyPublication({...input,store:{articles:[
    story("2026-02-30T22:17:50Z")]}});
  assert.equal(fake.passed,false);
  assert.equal(fake.committedStoryCount,0);
  assert.equal(fake.code,"MISSED_HOURLY_TARGET_NO_COMMITTED_STORY");
  const valid=evaluateHourlyPublication({...input,store:{articles:[
    story("2026-03-02T22:17:50Z")]}});
  assert.equal(valid.passed,true);
  assert.equal(valid.committedStoryCount,1);
});

test("future articles in the target hour must not masquerade as already committed",()=>{
  const claimed={articles:[story("2026-10-24T08:59:00Z")]};
  const invalid={eventName:"workflow_dispatch",schedulerOrigin:"cloudflare",
    scheduledHourUtc:"2026-10-24T08:00:00Z",now:new Date("2026-10-24T08:25:00Z")};
  const cloud=evaluateHourlyPublication({...invalid,store:claimed});
  assert.equal(cloud.passed,false);
  assert.equal(cloud.committedStoryCount,0);
  assert.equal(cloud.code,"MISSED_HOURLY_TARGET_NO_COMMITTED_STORY");
  const backup=evaluateHourlyPublication({eventName:"schedule",
    now:new Date("2026-10-24T08:48:00Z"),store:claimed});
  assert.equal(backup.hourUtc,"2026-10-24T08:00:00Z");
  assert.equal(backup.passed,false);
  const after=evaluateHourlyPublication({...invalid,
    now:new Date("2026-10-24T08:59:01Z"),store:claimed});
  assert.equal(after.passed,true);
});

test("invalid current time cannot turn a valid Cloudflare-input story into KPI PASS",()=>{
  const result=evaluateHourlyPublication({...cloudflare,now:new Date("bad-date"),
    store:{articles:[story()]}});
  assert.equal(result.enforced,true);
  assert.equal(result.passed,false);
  assert.equal(result.code,"INVALID_EVALUATION_TIME");
  assert.equal(result.cloudflareNativeEvent,"NOT_VERIFIED_BY_GITHUB_INPUT");
});

test("off-hour stories and malformed timestamps cannot inflate the current-hour count",()=>{
  const current=story();
  const store={articles:[current,story("2026-10-23T21:17:00.000Z"),
    story("2026-10-23T23:17:00.000Z"),story("2026-10-23T22:invalid")]};
  for(const route of [github,cloudflare]){
    const result=evaluateHourlyPublication({...route,store});
    assert.equal(result.passed,true);
    assert.equal(result.committedStoryCount,1);
  }
});

test("late GitHub native backup cannot count the next hour as a successful previous-hour publish",()=>{
  // Real incident: schedule declared at :47, run began 07:35:41Z;
  // old implementation accepted a 07:17Z story and hid a missed 06Z hour.
  const delayed={eventName:"schedule",now:new Date("2026-10-24T07:35:57Z")};
  const nextHourOnly={articles:[story("2026-10-24T07:17:48.716Z")]};
  const missed=evaluateHourlyPublication({...delayed,store:nextHourOnly});
  assert.equal(missed.hourUtc,"2026-10-24T06:00:00Z");
  assert.equal(missed.passed,false);
  assert.equal(missed.code,"MISSED_HOURLY_TARGET_NO_COMMITTED_STORY");
  const actualPrevious={articles:[story("2026-10-24T06:17:48.716Z")]};
  assert.equal(evaluateHourlyPublication({...delayed,store:actualPrevious}).passed,true);
});

test("on-time backup at :47 is checked against its own UTC hour including boundary rollover",()=>{
  const inHour=evaluateHourlyPublication({eventName:"schedule",
    now:new Date("2026-10-24T07:47:00Z"),store:{articles:[story("2026-10-24T07:17:48.716Z")]}});
  assert.equal(inHour.hourUtc,"2026-10-24T07:00:00Z");
  assert.equal(inHour.passed,true);
  const beforeDue=evaluateHourlyPublication({eventName:"schedule",
    now:new Date("2026-11-01T00:02:00Z"),store:{articles:[story("2026-10-31T23:47:01Z")]}});
  assert.equal(beforeDue.hourUtc,"2026-10-31T23:00:00Z");
  assert.equal(beforeDue.passed,true);
  assert.equal(evaluateHourlyPublication({eventName:"schedule",now:new Date("invalid"),
    store:{articles:[story()]}}).code,"INVALID_SCHEDULE_HOUR");
});

test("backup cron respects a published article and cannot create a second one",()=>{
  const backup={eventName:"schedule",now:new Date("2026-10-23T22:47:00Z")};
  assert.equal(evaluateHourlyPublication({...backup,store:{articles:[story()]}}).passed,true);
});

test("previous-hour, future-hour, and forged dates never satisfy current-hour KPI",()=>{
  for(const date of ["2026-10-23T21:17:50.063Z","2026-10-23T23:17:50.063Z",
    "2026-02-30T22:17:50.063Z","bad-2026-10-23T22:17:50.063Z"]){
    assert.equal(evaluateHourlyPublication({...cloudflare,store:{articles:[story(date)]}}).passed,false);
  }
});

test("missing or malformed claimed dispatch hour fails closed without native Cloudflare attestation",()=>{
  for(const time of [null,"2026-02-30T22:00:00Z","2026-10-23T22:17:00Z",
    "TOKEN=sensitive","2026-13-23T22:00:00Z"]){
    const result=evaluateHourlyPublication({...cloudflare,scheduledHourUtc:time,store:{articles:[story()]}});
    assert.equal(result.code,"INVALID_SCHEDULE_HOUR");
    assert.equal(result.passed,false);
    assert.ok(!JSON.stringify(result).includes("sensitive"));
  }
});

test("manual dispatch and pull requests cannot create scheduled publication failures",()=>{
  for(const attempt of [{eventName:"workflow_dispatch",schedulerOrigin:"manual"},
    {eventName:"pull_request",schedulerOrigin:"cloudflare"}]){
    const result=evaluateHourlyPublication({...attempt,store:{articles:[]}});
    assert.equal(result.enforced,false);
    assert.equal(result.code,"NOT_SCHEDULED");
  }
});

test("absent article data cannot be reported as a published article",()=>{
  assert.equal(evaluateHourlyPublication({...github,store:{articles:null}}).passed,false);
});

test("CLI exits nonzero when two articles were recorded in one scheduled hour",async()=>{
  const root=await mkdtemp(join(tmpdir(),"news-exactly-one-"));
  const bin=fileURLToPath(new URL("./hourly-publication-kpi.mjs",import.meta.url));
  try{
    await writeFile(join(root,"content.json"),JSON.stringify({articles:[story(),
      {...story("2026-10-23T22:39:00Z"),slug:"second-story"}]}));
    const env={...process.env,GITHUB_EVENT_NAME:"workflow_dispatch",
      NEWS_SCHEDULER_ORIGIN:"cloudflare",NEWS_SCHEDULED_HOUR_UTC:"2026-10-23T22:00:00Z"};
    const result=spawnSync(process.execPath,[bin],{cwd:root,env,encoding:"utf8"});
    assert.equal(result.status,1);
    assert.match(result.stderr,/MULTIPLE_COMMITTED_STORIES_IN_UTC_HOUR/);
    assert.match(result.stdout,/"committedStoryCount":2/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("CLI reports a missed scheduled hour as a failing job without API calls",async()=>{
  const root=await mkdtemp(join(tmpdir(),"news-kpi-test-"));
  const bin=fileURLToPath(new URL("./hourly-publication-kpi.mjs",import.meta.url));
  try{
    await writeFile(join(root,"content.json"),JSON.stringify({articles:[]}));
    const env={...process.env,GITHUB_EVENT_NAME:"workflow_dispatch",
      NEWS_SCHEDULER_ORIGIN:"cloudflare",NEWS_SCHEDULED_HOUR_UTC:"2026-10-23T22:00:00Z"};
    const failed=spawnSync(process.execPath,[bin],{cwd:root,env,encoding:"utf8"});
    assert.equal(failed.status,1);
    assert.match(failed.stderr,/MISSED_HOURLY_TARGET_NO_COMMITTED_STORY/);
    await writeFile(join(root,"content.json"),JSON.stringify({articles:[story()]}));
    const passed=spawnSync(process.execPath,[bin],{cwd:root,env,encoding:"utf8"});
    assert.equal(passed.status,0);
    assert.match(passed.stdout,/COMMITTED_STORY_PRESENT/);
    assert.match(passed.stdout,/NOT_VERIFIED_BY_GITHUB_INPUT/);
  }finally{await rm(root,{recursive:true,force:true});}
});
