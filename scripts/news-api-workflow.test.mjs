import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const workflow=await fs.readFile(new URL("../.github/workflows/news-api-test.yml",import.meta.url),"utf8");

test("readiness is the harmless default for manual dispatch",()=>{
  assert.match(workflow,/workflow_dispatch:\s*\n\s+inputs:\s*\n\s+mode:/);
  assert.match(workflow,/default: readiness/);
  assert.match(workflow,/options:\s*\n\s+- readiness\s*\n\s+- live-api/);
});

test("public configuration can be checked without an API key or network",()=>{
  const readiness=workflow.split("\n  config-readiness:\n")[1]?.split("\n  api-probe:\n")[0];
  assert.ok(readiness,"config-readiness job must be present");
  assert.match(readiness,/NEWS_ENV_READY_NON_SECRET_ONLY/);
  assert.match(readiness,/NEWS_ENV_NOT_READY:/);
  assert.match(readiness,/vars\.REVIEWER_MODEL/);
  assert.match(readiness,/gemini-3\.5-flash/);
  assert.doesNotMatch(readiness,/secrets\.|NEWS_API_TEST_KEY|modelJson|curl |fetch\(/);
});

test("live probes require explicit intent and successful readiness",()=>{
  const live=workflow.split("\n  api-probe:\n")[1];
  assert.ok(live,"api-probe job must be present");
  assert.match(live,/inputs\.mode == 'live-api'/);
  assert.match(live,/needs: \[source-tests, config-readiness\]/);
  assert.match(live,/secrets\.NEWS_API_TEST_KEY/);
  assert.match(live,/NEWS_API_TEST_KEY/);
  assert.match(live,/NO_PUBLICATION_PERFORMED/);
});

test("the isolated workflow has no write or automatic publish permission",()=>{
  assert.match(workflow,/permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow,/(?:^|\n)\s+push:|contents: write|schedule:|git push|gh api .*actions\/variables/);
  assert.match(workflow,/node --test scripts\/hourly-publish\.test\.mjs scripts\/news-api-workflow\.test\.mjs/);
});


test("pull requests execute non-secret readiness but never provider calls",()=>{
  const readiness=workflow.split("\n  config-readiness:\n")[1]?.split("\n  api-probe:\n")[0];
  assert.ok(readiness,"config-readiness job must be present");
  assert.match(readiness,/if:.*github\.event_name == 'pull_request'/);
  assert.match(readiness,/NEWS_ENV_NOT_READY:/);
  assert.match(readiness,/NEWS_ENV_READY_NON_SECRET_ONLY/);
  assert.doesNotMatch(readiness,/secrets\.|NEWS_API_TEST_KEY|modelJson|curl |fetch\(/);
  const live=workflow.split("\n  api-probe:\n")[1];
  assert.match(live,/if: github\.event_name == 'workflow_dispatch' && inputs\.mode == 'live-api'/);
});
