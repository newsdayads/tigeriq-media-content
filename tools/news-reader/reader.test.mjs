import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");
const capture=html.match(/<script id="snapshot" type="application\/json">([\s\S]*?)<\/script>/);
const snapshot=capture?JSON.parse(capture[1]):null;

test("self-contained snapshot contains all 32 complete trilingual published articles",()=>{
  assert.ok(snapshot,"offline snapshot must exist");
  assert.equal(snapshot.articles.length,32);
  assert.equal(snapshot.updatedAt,"2026-10-22T07:17:49.108Z");
  assert.equal(new Set(snapshot.articles.map(a=>a.slug)).size,32);
  for(const a of snapshot.articles){
    assert.match(a.slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    for(const locale of ["vi","en","es"]){
      const edition=a.editions?.[locale];
      assert.ok(edition?.title?.trim(),a.slug+" "+locale+" title");
      assert.ok(edition?.dek?.trim(),a.slug+" "+locale+" dek");
      assert.ok(Array.isArray(edition.sections)&&edition.sections.length>0,a.slug+" "+locale+" article body");
      assert.ok(edition.sections.some(s=>s.body?.trim().length>=20),a.slug+" "+locale+" nonempty body");
    }
  }
});

test("pinned source provenance and no executable external library dependencies",()=>{
  assert.match(html,/899043b6d4723763b34249556c414dd5f1707ee3/);
  assert.equal((html.match(/<script/g)||[]).length,2);
  assert.doesNotMatch(html,/<script[^>]+src=/i);
  assert.doesNotMatch(html,/\binnerHTML\b|\beval\s*\(/);
  assert.doesNotMatch(html,/<iframe\b/i);
});

test("reader implementation passes JavaScript syntax and exposes offline full article view",()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,2);
  assert.doesNotThrow(()=>new Function(scripts[1][1]));
  assert.match(scripts[1][1],/function renderArticle\(/);
  assert.match(scripts[1][1],/\.showModal\(\)/);
  assert.match(scripts[1][1],/function validFeed\(/);
  assert.match(scripts[1][1],/noopener noreferrer/);
});

test("all offline editions include the same articles and stable source IDs",()=>{
  const ids=snapshot.articles.map(a=>a.slug);
  for(const locale of ["vi","en","es"]){
    const localeIds=snapshot.articles.filter(a=>a.editions?.[locale]?.title).map(a=>a.slug);
    assert.deepEqual(localeIds,ids);
  }
  assert.ok(snapshot.articles.every(a=>Number.isFinite(Date.parse(a.publishedAt))));
});
