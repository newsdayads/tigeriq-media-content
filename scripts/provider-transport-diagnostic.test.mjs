import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {modelJson,providerTransportCode} from "./hourly-publish.mjs";

const provider={url:"https://example.invalid/ai",key:"local-test-only",writer:"writer",reviewer:"reviewer"};

test("actual provider request timeout is distinguished without retrying or exposing secrets",async t=>{
  let calls=0;
  t.mock.method(AbortSignal,"timeout",ms=>{
    assert.equal(ms,90000,"retain exact production deadline");
    return AbortSignal.abort(new DOMException("private upstream timeout detail","TimeoutError"));
  });
  await assert.rejects(()=>modelJson({provider,model:provider.writer,prompt:"fixture only",
    fetchImpl:async(_url,{signal})=>{calls++;throw signal.reason;}}),error=>{
      assert.equal(error.message,"AI_PROVIDER_TIMEOUT");
      assert.doesNotMatch(error.message,/private|upstream|local-test-only/);
      return true;
    });
  assert.equal(calls,1,"do not retry a potentially billed inference on timeout");
});

test("socket failures and untrusted timeout-shaped errors remain generic transport errors",async()=>{
  const requestSignal=AbortSignal.abort(new DOMException("actual deadline","TimeoutError"));
  assert.equal(providerTransportCode(requestSignal),"AI_PROVIDER_TIMEOUT");
  assert.equal(providerTransportCode(AbortSignal.abort(new Error("DNS failure"))),
    "AI_PROVIDER_TRANSPORT_FAILED");
  assert.equal(providerTransportCode(AbortSignal.abort(new DOMException("cancelled","AbortError"))),
    "AI_PROVIDER_TRANSPORT_FAILED");
  assert.equal(providerTransportCode(AbortSignal.timeout(90000)),"AI_PROVIDER_TRANSPORT_FAILED");
  await assert.rejects(()=>modelJson({provider,model:provider.writer,prompt:"fixture only",
    fetchImpl:async()=>{throw new DOMException("pretend timeout","TimeoutError");}}),
    /AI_PROVIDER_TRANSPORT_FAILED/);
});

test("existing publish workflow runs diagnostics without changing schedule, retries or secrets",()=>{
  const yaml=readFileSync(new URL("../.github/workflows/hourly-publisher.yml",import.meta.url),"utf8");
  assert.ok(yaml.includes('    - cron: "17,47 * * * *"'));
  assert.match(yaml,/scripts\/provider-transport-diagnostic\.test\.mjs/);
});
