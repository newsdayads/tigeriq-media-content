import test from "node:test";
import assert from "node:assert/strict";
import {classifyCoverTheme,editorialCoverSvg} from "./editorial-cover.mjs";

const samples=[
 ["AI cloud data center infrastructure","cloud"],
 ["GPU chip accelerator architecture","hardware"],
 ["Protect private secrets with security rulesets","security"],
 ["Satellite orbits Earth","space"],
 ["GitHub Copilot API coding assistant","software"],
 ["Mobile phone and desktop devices","device"],
 ["Human AI mathematics research papers","research"],
 ["AI investment growth returns","finance"],
 ["Engineer training academy","training"]
];
test("nine distinct themes draw semantic scene objects, not the legacy circle template",()=>{
 const signatures=new Set();
 for(const [title,expected] of samples){
  assert.equal(classifyCoverTheme(title),expected);
  const svg=editorialCoverSvg(title);
  assert.match(svg,new RegExp('data-scene="'+expected+'"'));
  assert.match(svg,/<title id="title">/);
  assert.match(svg,/<desc id="desc">/);
  assert.doesNotMatch(svg,/AI &amp; TECHNOLOGY|<circle cx="935"/);
  assert.match(svg,/<\/svg>\n$/);
  signatures.add(svg.match(/<g data-scene="[^"]+"[^>]*>(.*?)<\/g>/)?.[1]);
 }
 assert.equal(signatures.size,samples.length);
});
test("slug can resolve topic when localized title omits it",()=>{
 assert.equal(classifyCoverTheme("Bản tin công nghệ","google-cloud-compute"),"cloud");
});
test("untrusted headline is escaped and forbidden XML characters are dropped",()=>{
 const svg=editorialCoverSvg('<unsafe>&news\u0000\u0001\uD800');
 assert.match(svg,/&lt;unsafe&gt;&amp;news/);
 assert.doesNotMatch(svg,/<unsafe>|[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/u);
});
test("non-BMP code point fits at the 70-character headline boundary",()=>{
 const svg=editorialCoverSvg("A".repeat(68)+"🚀");
 assert.match(svg,/🚀/u);
});
test("self-contained SVG has no remote references, scripts, branding logos or AI expense",()=>{
 for(const [title] of samples){
  const svg=editorialCoverSvg(title);
  assert.doesNotMatch(svg,/<script|<image|<foreignObject|https?:\/\/|url\(["']?https?:/i);
  assert.match(svg,/width="1200" height="675"/);
  assert.match(svg,/Original TigerIQ conceptual editorial scene/);
 }
});
