import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const CANONICAL_COVER='https://raw.githubusercontent.com/newsdayads/tigeriq-media-content/main/covers/';

function checkGeneratedCovers(articles, readAsset=slug=>
  readFileSync(new URL('../covers/'+slug+'.svg', import.meta.url),'utf8')) {
  let checked=0;
  for (const article of articles) {
    const cover=article?.cover;
    // External licensed raster covers have a different lifecycle. Validate
    // locally generated SVGs against the actual checked-out Git tree.
    if (cover?.generated!==true || typeof cover.url!=='string' || !cover.url.endsWith('.svg')) continue;
    const slug=article.slug;
    if (typeof slug!=='string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
        cover.url!==CANONICAL_COVER+slug+'.svg')
      throw Error('COVER_STALE_REFERENCE '+String(slug));
    let body;
    try { body=readAsset(slug); } catch { throw Error('COVER_ASSET_MISSING '+slug); }
    if (typeof body!=='string' || !body.includes('<svg'))
      throw Error('COVER_ASSET_INVALID '+slug);
    checked++;
  }
  return checked;
}

test('published stories use their own checked-in original SVG cover', () => {
  const data=JSON.parse(readFileSync(new URL('../content.json',import.meta.url),'utf8'));
  assert.ok(Array.isArray(data.articles) && data.articles.length>0);
  assert.ok(checkGeneratedCovers(data.articles)>0);
});

test('cross-story reused cover URL is rejected without provider or network calls', () => {
  const articles=[{slug:'subject-a',cover:{generated:true,url:CANONICAL_COVER+'subject-b.svg'}}];
  assert.throws(()=>checkGeneratedCovers(articles),/COVER_STALE_REFERENCE subject-a/);
});

test('missing checked-in cover cannot pass an editorial-only PR', () => {
  const articles=[{slug:'subject-a',cover:{generated:true,url:CANONICAL_COVER+'subject-a.svg'}}];
  assert.throws(()=>checkGeneratedCovers(articles,()=>{throw Error('ENOENT');}),
    /COVER_ASSET_MISSING subject-a/);
});
