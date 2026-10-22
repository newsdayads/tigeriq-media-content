import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {scheduledHourUtc,dispatchNewsHour} from "./src/cron.mjs";
import worker from "./src/cron.mjs";

test("external cron targets exact main workflow once with nonsecret receipt",async()=>{
  const calls=[];
  const r=await dispatchNewsHour({
    env:{GITHUB_ACTIONS_TOKEN:"github-fine-grained-test-token"},
    scheduledTime:Date.parse("2026-10-21T03:17:09Z"),
    fetchImpl:async (url,init)=>{calls.push({url,init});return {status:204};}
  });
  assert.equal(r.hour,"2026-10-21T03:00:00Z");
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/\/actions\/workflows\/hourly-publisher\.yml\/dispatches$/);
  assert.equal(calls[0].init.method,"POST");
  assert.deepEqual(JSON.parse(calls[0].init.body),{
    ref:"main",inputs:{scheduler:"cloudflare",scheduled_hour_utc:"2026-10-21T03:00:00Z"}
  });
  assert.equal(calls[0].init.headers.Authorization,"Bearer github-fine-grained-test-token");
});
test("both synthetic timestamps preserve the same canonical UTC hour marker",async()=>{
 const packets=[];
 const env={GITHUB_ACTIONS_TOKEN:"github-fine-grained-test-token"};
 const fetchImpl=async (_url,options)=>{packets.push(JSON.parse(options.body));return {status:204};};
 for(const minute of [17,47])
   await dispatchNewsHour({env,scheduledTime:Date.parse("2026-10-21T03:"+minute+":00Z"),fetchImpl});
 assert.equal(packets.length,2);
 assert.equal(packets[0].inputs.scheduled_hour_utc,"2026-10-21T03:00:00Z");
 assert.deepEqual(packets[0],packets[1]);
});

test("missing credentials and invalid scheduler inputs fail closed",async()=>{
  await assert.rejects(()=>dispatchNewsHour({env:{},scheduledTime:Date.now(),fetchImpl:()=>{throw Error("MUST_NOT_CALL");}}),/GITHUB_ACTIONS_TOKEN_NOT_CONFIGURED/);
  assert.throws(()=>scheduledHourUtc("garbage"),/INVALID_SCHEDULED_TIME/);
  await assert.rejects(()=>dispatchNewsHour({env:{GITHUB_ACTIONS_TOKEN:"github-fine-grained-test-token"},scheduledTime:Date.now(),fetchImpl:async()=>({status:403})}),/GITHUB_WORKFLOW_DISPATCH_HTTP_403/);
});
test("worker has only scheduled handler; no public request endpoint",()=>{
  assert.equal(typeof worker.scheduled,"function");
  assert.equal(worker.fetch,undefined);
});

test("each configured scheduler has one distinct UTC-minute trigger",()=>{
  const wrangler=readFileSync(new URL("./wrangler.toml",import.meta.url),"utf8");
  const workflow=readFileSync(new URL("../../.github/workflows/hourly-publisher.yml",import.meta.url),"utf8");
  assert.equal(wrangler.split("\n").find(line=>line.startsWith("crons = ")),
    'crons = ["17 * * * *"]');
  assert.deepEqual([...workflow.matchAll(/^    - cron: "([^"]+)"$/gm)].map(x=>x[1]),
    ["47 * * * *"]);
});
