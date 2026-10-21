import test from "node:test";
import assert from "node:assert/strict";
import {scheduledOriginReceipt} from "./scheduled-origin-receipt.mjs";

test("Cloudflare input yields an explicit non-attested GitHub correlation receipt",()=>{
  const r=scheduledOriginReceipt({GITHUB_EVENT_NAME:"workflow_dispatch",NEWS_SCHEDULER_ORIGIN:"cloudflare",
    NEWS_SCHEDULED_HOUR_UTC:"2026-10-21T06:00:00Z",GITHUB_RUN_ID:"39554511021",GITHUB_RUN_ATTEMPT:"1"});
  assert.deepEqual(r,{event:"workflow_dispatch",origin:"cloudflare_input_unverified",
    scheduledHourUtc:"2026-10-21T06:00:00Z",githubRunId:"39554511021",
    githubRunAttempt:"1",cloudflareNativeEvent:"NOT_VERIFIED_BY_GITHUB_INPUT"});
});

test("malformed and nonexistent hours fail closed without leaking raw input",()=>{
  for(const bad of ["2026-02-30T06:00:00Z","2026-10-21T06:17:00Z","X_TOKEN=secret","2026-13-21T06:00:00Z",null]){
    const r=scheduledOriginReceipt({GITHUB_EVENT_NAME:"workflow_dispatch",NEWS_SCHEDULER_ORIGIN:"cloudflare",NEWS_SCHEDULED_HOUR_UTC:bad,GITHUB_RUN_ID:"1;secret"});
    assert.equal(r.scheduledHourUtc,null);
    assert.equal(r.githubRunId,null);
    assert.ok(!JSON.stringify(r).includes("secret"));
  }
});

test("GitHub native schedule and manual dispatch cannot be mislabelled as Cloudflare native logs",()=>{
  const native=scheduledOriginReceipt({GITHUB_EVENT_NAME:"schedule",NEWS_SCHEDULER_ORIGIN:"cloudflare",NEWS_SCHEDULED_HOUR_UTC:"2026-10-21T07:00:00Z"});
  assert.equal(native.origin,"github_native_schedule");
  assert.equal(native.scheduledHourUtc,null);
  const manual=scheduledOriginReceipt({GITHUB_EVENT_NAME:"workflow_dispatch",NEWS_SCHEDULER_ORIGIN:"manual",NEWS_SCHEDULED_HOUR_UTC:"2026-10-21T07:00:00Z"});
  assert.equal(manual.origin,"manual_or_other");
  assert.equal(manual.cloudflareNativeEvent,"NOT_VERIFIED_BY_GITHUB_INPUT");
});
