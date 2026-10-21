import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {missedHourlyTarget} from "./hourly-publish.mjs";

test("Cloudflare scheduled dispatch reports missed hourly news; manual and PR do not",()=>{
  const reason="NOOP_NO_VERIFIABLE_STORY";
  const expected="MISSED_HOURLY_TARGET "+reason;
  assert.equal(missedHourlyTarget(reason,"schedule"),expected);
  assert.equal(missedHourlyTarget(reason,"workflow_dispatch","cloudflare"),expected);
  assert.equal(missedHourlyTarget(reason,"workflow_dispatch","manual"),null);
  assert.equal(missedHourlyTarget(reason,"workflow_dispatch",""),null);
  assert.equal(missedHourlyTarget(reason,"pull_request","cloudflare"),null);
  assert.equal(missedHourlyTarget("API_TOKEN=private-value","workflow_dispatch","cloudflare"),
    "MISSED_HOURLY_TARGET UNCLASSIFIED_FAILURE");
});

test("publisher forwards dispatch origin to reporter without changing production cron",()=>{
  const yaml=readFileSync(new URL("../.github/workflows/hourly-publisher.yml",import.meta.url),"utf8");
  assert.match(yaml,/^          NEWS_SCHEDULER_ORIGIN: \$\{\{ inputs\.scheduler \}\}$/m);
  assert.match(yaml,/^    - cron: "17 \/\*\/1 \* \* \*"$/m);
  assert.match(yaml,/scripts\/cloudflare-scheduled-kpi\.test\.mjs/);
});
