import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateVisualMetadata,verifyRasterBytes,visualExtension} from './editorial-visual-contract.mjs';

const CANONICAL_COVER='https://raw.githubusercontent.com/newsdayads/tigeriq-media-content/main/covers/';

function checkGeneratedCovers(articles, readAsset=(slug,extension,binary)=>
  readFileSync(new URL('../covers/'+slug+'.'+extension, import.meta.url),binary?undefined:'utf8')) {
  let checked=0;
  for (const article of articles) {
    const slug=article?.slug,cover=article?.cover;
    let visual;
    try{visual=validateVisualMetadata(cover,{slug,allowLegacy:true});}
    catch{throw Error('COVER_METADATA_INVALID '+String(slug));}
    if(visual.legacy){
      let body;
      try { body=readAsset(slug,'svg',false); } catch { throw Error('COVER_ASSET_MISSING '+slug); }
      if (typeof body!=='string' || !body.includes('<svg'))
        throw Error('COVER_ASSET_INVALID '+slug);
    }else{
      const extension=visualExtension(cover.mime);
      let body;
      try { body=readAsset(slug,extension,true); } catch { throw Error('COVER_ASSET_MISSING '+slug); }
      try{verifyRasterBytes(body,cover);}catch{throw Error('COVER_ASSET_INVALID '+slug);}
    }
    checked++;
  }
  return checked;
}

test('published stories use their own checked-in legacy SVG or verified raster cover', () => {
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
