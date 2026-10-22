import test from "node:test";
import assert from "node:assert/strict";
import {validateDraft} from "./hourly-publish.mjs";
import {readFileSync} from "node:fs";

const sources=[
  {id:"o",publisher:"openai",url:"https://openai.com/news/verified",title:"Verified AI deployment"},
  {id:"g",publisher:"google",url:"https://blog.google/technology/ai/verified",title:"Verified AI deployment"}
];
function edition(lang,nSections=3,nTakeaways=3){
  return {
    title:lang+" official AI deployment findings",
    dek:"Evidence-backed announcement with clear technical limitations in "+lang,
    takeaways:Array.from({length:nTakeaways},(_,i)=>"Documented source finding number "+(i+1)),
    sections:Array.from({length:nSections},(_,i)=>({
      heading:"Source evidence section "+(i+1),
      body:"This section covers a documented technical consequence, a concrete primary-source observation, and the relevant measured limitation without unsupported extrapolation."
    }))
  };
}
function draft(sections=3,takeaways=3){
  return {
    slug:"verified-ai-report",category:"Technology",readTime:4,
    sourceIds:["o","g"],
    claims:[
      {text:"Both publishers document the deployment",sourceIds:["o","g"]},
      {text:"Both publishers state the scope and limitations",sourceIds:["o","g"]}
    ],
    editions:Object.fromEntries(["vi","en","es"].map(lang=>[lang,edition(lang,sections,takeaways)]))
  };
}

test("substantive short article can have two sections and two takeaways in all three locales",()=>{
  assert.equal(validateDraft(draft(2,2),sources).length,2);
});

test("longer verified coverage can have four or six sections rather than forced three",()=>{
  assert.equal(validateDraft(draft(4,4),sources).length,2);
  assert.equal(validateDraft(draft(6,5),sources).length,2);
});

test("one-section thin draft and oversized template remain rejected",()=>{
  assert.throws(()=>validateDraft(draft(1,2),sources),/DRAFT_LOCALE_QUALITY_vi/);
  assert.throws(()=>validateDraft(draft(7,2),sources),/DRAFT_LOCALE_QUALITY_vi/);
  assert.throws(()=>validateDraft(draft(2,1),sources),/DRAFT_LOCALE_QUALITY_vi/);
  assert.throws(()=>validateDraft(draft(2,6),sources),/DRAFT_LOCALE_QUALITY_vi/);
});

test("two short sections with insufficient reported detail must not pass",()=>{
  const thin=draft(2,2);
  for(const lang of ["vi","en","es"]){
    for(const section of thin.editions[lang].sections){
      section.body="The official announcement reports a few observed results without a detailed explanation.";
    }
  }
  assert.throws(()=>validateDraft(thin,sources),/DRAFT_LOCALE_QUALITY_vi/);
});

test("source and independent-review gate stay wired to pull-request automated tests",()=>{
  const yaml=readFileSync(new URL("../.github/workflows/hourly-publisher.yml",import.meta.url),"utf8");
  assert.match(yaml,/^      - scripts\/editorial-structure\.test\.mjs$/m);
  assert.match(yaml,/^        run: node --test .*scripts\/editorial-structure\.test\.mjs/m);
  assert.match(yaml,/^    if: github\.event_name != 'pull_request'$/m);
  assert.match(yaml,/^    - cron: "47 \* \* \* \*"$/m);
});
