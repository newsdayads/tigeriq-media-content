import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

const CONTENT_URL = new URL('../content.json', import.meta.url);
const LOCAL_COVER_BASE = 'https://raw.githubusercontent.com/newsdayads/tigeriq-media-content/main/covers/';
const LOCALES = ['vi', 'en', 'es'];
const MUSE_SLUG = 'meta-muse-spark-open-math-research-2026';

const catalog = JSON.parse(await readFile(CONTENT_URL, 'utf8'));

function validateCatalog(data) {
  const faults = [];
  if (!Array.isArray(data?.articles) || data.articles.length < 24) return ['CATALOG_TOO_SHORT'];
  const seen = new Set();
  for (const [index, article] of data.articles.entries()) {
    const slug = article?.slug;
    if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      faults.push('INVALID_SLUG_' + index);
      continue;
    }
    if (seen.has(slug)) faults.push('DUPLICATE_SLUG_' + slug);
    seen.add(slug);
    for (const locale of LOCALES) {
      const edition = article.editions?.[locale];
      if (!edition || typeof edition.title !== 'string' || !edition.title.trim() ||
          typeof edition.dek !== 'string' || !edition.dek.trim() ||
          !Array.isArray(edition.takeaways) || edition.takeaways.length === 0 ||
          !Array.isArray(edition.sections) || edition.sections.length === 0) {
        faults.push('INCOMPLETE_EDITION_' + locale + '_' + slug);
      }
    }
    const cover = article.cover?.url;
    if (typeof cover !== 'string' || !/^https:\/\//.test(cover)) {
      faults.push('MISSING_COVER_' + slug);
    }
    if (!Array.isArray(article.sources) || article.sources.length === 0) {
      faults.push('MISSING_SOURCE_' + slug);
    }
  }
  return faults;
}

test('published catalog has unique slugs, 3 complete editions, covers and sources', () => {
  assert.deepEqual(validateCatalog(catalog), []);
});

test('regression: a missing Spanish edition and a missing cover are both rejected', () => {
  const broken = structuredClone(catalog);
  const old = broken.articles.find((article) => article.slug === MUSE_SLUG);
  assert.ok(old, 'historical research story must exist');
  delete old.editions.es;
  delete old.cover;
  assert.ok(validateCatalog(broken).includes('INCOMPLETE_EDITION_es_' + MUSE_SLUG));
  assert.ok(validateCatalog(broken).includes('MISSING_COVER_' + MUSE_SLUG));
});

test('restored six-paper research article retains its original publication date', () => {
  const article = catalog.articles.find((a) => a.slug === MUSE_SLUG);
  assert.equal(article.publishedAt, '2026-10-04T09:51:17.445Z');
  assert.equal(article.editions.es.sections.length, article.editions.en.sections.length);
  assert.equal(article.cover.url, LOCAL_COVER_BASE + MUSE_SLUG + '.svg');
  assert.equal(article.cover.width, 1200);
  assert.equal(article.cover.height, 675);
});

test('every repository-hosted cover resolves to an existing SVG file', async () => {
  for (const article of catalog.articles) {
    const url = article.cover.url;
    if (!url.startsWith(LOCAL_COVER_BASE)) continue;
    const filename = url.slice(LOCAL_COVER_BASE.length);
    assert.match(filename, /^[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/, article.slug);
    const path = resolve(fileURLToPath(new URL('..', import.meta.url)), 'covers', filename);
    const coversRoot = resolve(fileURLToPath(new URL('..', import.meta.url)), 'covers');
    assert.ok(path.startsWith(coversRoot + sep), 'COVER_PATH_OUTSIDE_ROOT');
    await access(path);
  }
});

test('new editorial SVG is self-contained and has valid accessible text', async () => {
  const svg = await readFile(new URL('../covers/' + MUSE_SLUG + '.svg', import.meta.url), 'utf8');
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /<title id="title">/);
  assert.match(svg, /<desc id="desc">/);
  assert.match(svg, /<\/svg>\s*$/);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  const payload = svg.replace('xmlns="http://www.w3.org/2000/svg"', '');
  assert.doesNotMatch(payload, /<script\b|<foreignObject\b|https?:\/\/|xlink:href\s*=/i);
});
