import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REVIEW_EXCERPT_INSTRUCTION } from "./hourly-publish.mjs";

const publisher = readFileSync(new URL("./hourly-publish.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/hourly-publisher.yml", import.meta.url), "utf8");

test("the reviewer receives an unambiguous verbatim source evidence instruction", () => {
  assert.match(REVIEW_EXCERPT_INSTRUCTION, /CONTIGUOUS span of 24 to 500 characters/);
  assert.match(REVIEW_EXCERPT_INSTRUCTION, /directly from that exact source ID title or summary/);
  assert.match(REVIEW_EXCERPT_INSTRUCTION, /Do NOT paraphrase, translate/);
  assert.match(REVIEW_EXCERPT_INSTRUCTION, /return pass:false without inventing evidence/);
});

test("verbatim instruction is part of the one reviewer prompt for both source modes", () => {
  const reviewStart = publisher.indexOf("const review=await modelJson(");
  const verifyCall = publisher.indexOf("verifyReview(review,draft,sources);", reviewStart);
  assert.ok(reviewStart>=0&&verifyCall>reviewStart);
  const call = publisher.slice(reviewStart,verifyCall);
  assert.match(call, /prompt:\(attributed\?/);
  assert.match(call, /\)\+' '\+REVIEW_EXCERPT_INSTRUCTION\}\);/);
  assert.match(call, /' DRAFT='\+JSON\.stringify\(draft\)/);
  assert.match(call, /' SOURCE='\+JSON\.stringify\(sources\)/);
});

test("independent source excerpt verification remains fail closed", () => {
  const verifier = publisher.slice(publisher.indexOf("export function verifyReview("),
    publisher.indexOf("const svgEscape=",publisher.indexOf("export function verifyReview(")));
  assert.match(verifier, /throw Error\("REVIEW_EXCERPTS_UNVERIFIED"\)/);
  assert.match(verifier, /original\.includes\(passage\)/);
  assert.match(verifier, /e\.text\.trim\(\)\.length<24\|\|e\.text\.length>500/);
});

test("the exact-head required publisher CI includes this prompt regression test", () => {
  assert.match(workflow,/^      - scripts\/reviewer-evidence-prompt\.test\.mjs$/m);
  assert.match(workflow,/^        run: node --test .*scripts\/reviewer-evidence-prompt\.test\.mjs/m);
});
