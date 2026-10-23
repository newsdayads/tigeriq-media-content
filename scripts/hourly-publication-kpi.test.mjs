import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {evaluateHourlyPublication} from "./hourly-publication-kpi.mjs";

const at=new Date("2026-10-23T22:20:00.000Z");
const story=(publishedAt="2026-10-23T22:17:50.063Z")=>({slug:"verified-story",publishedAt});
const github={eventName:"schedule",now:at};
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
