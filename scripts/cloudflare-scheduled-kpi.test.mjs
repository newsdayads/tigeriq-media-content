import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {missedHourlyTarget} from "./hourly-publish.mjs";

test("quality-first scheduled NOOP is accepted while genuine failures remain visible",()=>{
  const reason="NOOP_NO_VERIFIABLE_STORY";
  assert.equal(missedHourlyTarget(reason,"schedule"),null);
  assert.equal(missedHourlyTarget(reason,"workflow_dispatch","cloudflare"),null);
  assert.equal(missedHourlyTarget(reason,"workflow_dispatch","manual"),null);
  assert.equal(missedHourlyTarget(reason,"workflow_dispatch",""),null);
  assert.equal(missedHourlyTarget(reason,"pull_request","cloudflare"),null);
  const expected="MISSED_HOURLY_TARGET AI_PROVIDER_HTTP_503";
  assert.equal(missedHourlyTarget("AI_PROVIDER_HTTP_503","schedule"),expected);
  assert.equal(missedHourlyTarget("AI_PROVIDER_HTTP_503","workflow_dispatch","cloudflare"),expected);
  assert.equal(missedHourlyTarget("API_TOKEN=private-value","workflow_dispatch","cloudflare"),
    "MISSED_HOURLY_TARGET UNCLASSIFIED_FAILURE");
});

test("publisher forwards origin with exactly one staggered native backup",()=>{
  const yaml=readFileSync(new URL("../.github/workflows/hourly-publisher.yml",import.meta.url),"utf8");
  assert.match(yaml,/^          NEWS_SCHEDULER_ORIGIN: \$\{\{ inputs\.scheduler \}\}$/m);
  assert.ok(yaml.includes('    - cron: "47 * * * *"'));
  assert.match(yaml,/scripts\/cloudflare-scheduled-kpi\.test\.mjs/);
});
