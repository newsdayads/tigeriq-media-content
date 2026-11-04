import test from "node:test";
import assert from "node:assert/strict";
import {validateDraft,lockMasterFactPack,validateEditorialV2Draft,verifyEditorialRubric} from "./hourly-publish.mjs";
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


test("editorial V2 locks a deterministic Master Fact Pack before drafting",()=>{
  const items=[
    {...sources[0],summary:"Primary source evidence with documented methods and limitations.",evidenceMode:"official-full-article"},
    {...sources[1],summary:"Independent source evidence with corroborated scope and caveats.",evidenceMode:"official-full-article"}
  ];
  const a=lockMasterFactPack(items,{attributed:false});
  const b=lockMasterFactPack(structuredClone(items),{attributed:false});
  assert.equal(a.locked,true);
  assert.equal(a.version,2);
  assert.equal(a.sources.length,2);
  assert.equal(a.digest,b.digest);
  assert.throws(()=>lockMasterFactPack([items[0]],{attributed:false}),/FACT_PACK_SOURCE_DIVERSITY_INSUFFICIENT/);
  assert.doesNotThrow(()=>lockMasterFactPack([items[0]],{attributed:true}));
});

test("editorial V2 requires class, angle, context, original value, limitations and typed claims",()=>{
  const d=draft(2,2);
  Object.assign(d,{
    editorialVersion:2,storyClass:"Analysis",
    angle:"Compare the corroborated deployment evidence and explain the documented operational trade-offs.",
    context:"Both official sources describe the same deployment scope, measured behavior and stated limitations.",
    originalValue:"The article connects the independent evidence to concrete operational consequences instead of paraphrasing a release.",
    limitations:["The available evidence supports only the documented deployment scope and does not establish broader market impact."]
  });
  d.claims=d.claims.map(claim=>({...claim,kind:"fact"}));
  assert.equal(validateEditorialV2Draft(d,{attributed:false}),true);
  const thin=structuredClone(d);thin.angle="too short";
  assert.throws(()=>validateEditorialV2Draft(thin,{attributed:false}),/EDITORIAL_ANGLE_INVALID/);
  const announcement=structuredClone(d);
  announcement.reportingMode="official-announcement";
  announcement.claims=announcement.claims.map(claim=>({...claim,kind:"attributed"}));
  assert.equal(validateEditorialV2Draft(announcement,{attributed:true}),true);
  announcement.claims[0].kind="fact";
  assert.throws(()=>validateEditorialV2Draft(announcement,{attributed:true}),/EDITORIAL_CLAIM_KIND_INVALID/);
});

test("editorial reviewer rubric is fail-closed at 80/100 and reserves visual score for N03",()=>{
  const good={editorialRubric:{source:20,verification:20,newsworthiness:15,originalValue:10,writing:10,context:10,visual:0,localeSeo:5},editorialScore:90};
  assert.equal(verifyEditorialRubric(good).score,90);
  const low=structuredClone(good);low.editorialRubric.originalValue=0;low.editorialRubric.context=0;low.editorialScore=70;
  assert.throws(()=>verifyEditorialRubric(low),/EDITORIAL_SCORE_BELOW_THRESHOLD/);
  const premature=structuredClone(good);premature.editorialRubric.visual=5;premature.editorialScore=95;
  assert.throws(()=>verifyEditorialRubric(premature),/EDITORIAL_VISUAL_SCORE_PREMATURE/);
  const mismatch=structuredClone(good);mismatch.editorialScore=89;
  assert.throws(()=>verifyEditorialRubric(mismatch),/EDITORIAL_SCORE_MISMATCH/);
});
