import test from "node:test";
import assert from "node:assert/strict";
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
test("missing credentials and invalid scheduler inputs fail closed",async()=>{
  await assert.rejects(()=>dispatchNewsHour({env:{},scheduledTime:Date.now(),fetchImpl:()=>{throw Error("MUST_NOT_CALL");}}),/GITHUB_ACTIONS_TOKEN_NOT_CONFIGURED/);
  assert.throws(()=>scheduledHourUtc("garbage"),/INVALID_SCHEDULED_TIME/);
  await assert.rejects(()=>dispatchNewsHour({env:{GITHUB_ACTIONS_TOKEN:"github-fine-grained-test-token"},scheduledTime:Date.now(),fetchImpl:async()=>({status:403})}),/GITHUB_WORKFLOW_DISPATCH_HTTP_403/);
});
test("worker has only scheduled handler; no public request endpoint",()=>{
  assert.equal(typeof worker.scheduled,"function");
  assert.equal(worker.fetch,undefined);
});
