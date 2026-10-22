import test from "node:test";
import assert from "node:assert/strict";
import {prioritizeOfficialCandidates} from "./hourly-publish.mjs";

const candidate=(publisher,minute,id=publisher)=>({
  publisher,id,url:"https://example.org/"+id,
  publishedAt:new Date(Date.parse("2026-10-22T12:00:00Z")+minute*60000).toISOString()
});
const article=publisher=>({
  factPack:{sources:[{publisher,url:"https://example.org/"+publisher}]}
});

test("a recent alternative breaks consecutive one-publisher stories without deleting candidates",()=>{
  const items=[candidate("nvidia",30),candidate("nvidia",26,"nvidia2"),
    candidate("google",17),candidate("openai",-50)];
  const copy=structuredClone(items);
  const result=prioritizeOfficialCandidates(items,[article("nvidia"),article("nvidia")]);
  assert.equal(result[0].publisher,"google");
  assert.deepEqual(result.slice(1).map(x=>x.id),["nvidia","nvidia2","openai"]);
  assert.deepEqual(items,copy,"never mutate caller feed entries");
});

test("materially newer announcement is never demoted for diversity",()=>{
  const items=[candidate("nvidia",30),candidate("google",-2),candidate("openai",-4)];
  assert.equal(prioritizeOfficialCandidates(items,[article("nvidia"),article("nvidia")])[0].publisher,"nvidia");
});

test("a new publisher is not force-selected until an actual two-story repeat",()=>{
  const items=[candidate("nvidia",30),candidate("google",26)];
  assert.equal(prioritizeOfficialCandidates(items,[article("nvidia"),article("github")])[0].publisher,"nvidia");
  assert.equal(prioritizeOfficialCandidates(items,[article("nvidia")])[0].publisher,"nvidia");
  assert.equal(prioritizeOfficialCandidates(items,[])[0].publisher,"nvidia");
});

test("unknown legacy provenance and absent alternatives preserve chronological order",()=>{
  const items=[candidate("nvidia",30),candidate("nvidia",20,"nv2")];
  assert.deepEqual(prioritizeOfficialCandidates(items,[article("nvidia"),article("nvidia")]),items);
  const alt=[candidate("nvidia",30),candidate("google",20)];
  assert.deepEqual(prioritizeOfficialCandidates(alt,[{slug:"legacy"},{slug:"legacy2"}]),alt);
  assert.deepEqual(prioritizeOfficialCandidates([],[]),[]);
});

test("only feed publisher metadata, not headline keywords, is used in tie-breaking",()=>{
  const items=[{...candidate("nvidia",30),title:"Major OpenAI product from NVIDIA official source"},
    {...candidate("github",22),title:"NVIDIA mentions inside GitHub changelog"}];
  assert.equal(prioritizeOfficialCandidates(items,[article("nvidia"),article("nvidia")])[0].publisher,"github");
});
