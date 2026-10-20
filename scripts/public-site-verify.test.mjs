import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPublishedArticle } from './public-site-verify.mjs';

const slug = 'example-ai-story';
const cover = 'https://raw.githubusercontent.com/newsdayads/tigeriq-media-content/main/covers/example-ai-story.svg';
const article = { slug, cover: { url: cover }, editions: {
  vi: { title: 'Tin AI mới' }, en: { title: 'New AI story' }, es: { title: 'Nueva historia IA' }
} };
const htmlByLang = Object.fromEntries(Object.entries(article.editions).map(([lang, data]) =>
  [lang, `<html lang="${lang}"><main><h1>${data.title}</h1><img src="${cover}"></main></html>`]));
function fakeFetch({ mutate = (x) => x, coverBody = '<svg width="20"></svg>', coverStatus = 200 } = {}) {
  return async (url) => {
    if (url === cover) return { status: coverStatus, text: async () => coverBody };
    const lang = new URL(url).pathname.split('/')[1];
    return { status: 200, text: async () => mutate(htmlByLang[lang] || '') };
  };
}

test('checks all three real site paths and the original cover without writing', async () => {
  const r = await verifyPublishedArticle(article, { fetcher: fakeFetch(), retries: 1 });
  assert.deepEqual(r.editions.map((x) => x.locale), ['vi','en','es']);
  assert.equal(r.coverStatus, 200);
  assert.equal(r.slug, slug);
});

test('rejects missing translated article even when HTTP succeeds', async () => {
  await assert.rejects(verifyPublishedArticle(article, {
    fetcher: fakeFetch({ mutate: (s) => s.replace('New AI story', '') }), retries: 1
  }), /LIVE_VERIFY_en_FAILED: LIVE_VERIFY_STALE_OR_MISSING_CONTENT/);
});

test('fails when the expected cover returns an error or invalid SVG', async () => {
  await assert.rejects(verifyPublishedArticle(article, {
    fetcher: fakeFetch({ coverStatus: 404 }), retries: 1
  }), /LIVE_VERIFY_HTTP_404/);
  await assert.rejects(verifyPublishedArticle(article, {
    fetcher: fakeFetch({ coverBody: '<html>not an image</html>' }), retries: 1
  }), /LIVE_VERIFY_COVER_INVALID_SVG/);
});

test('rejects unsafe slug, noncanonical cover and partial translations', async () => {
  await assert.rejects(verifyPublishedArticle({ ...article, slug: '../other' }, { fetcher: fakeFetch() }), /INVALID_SLUG/);
  await assert.rejects(verifyPublishedArticle({ ...article, cover: { url: 'https://external.example/malicious.svg' } }, { fetcher: fakeFetch() }), /UNTRUSTED_COVER/);
  await assert.rejects(verifyPublishedArticle({ ...article, editions: { vi: article.editions.vi } }, { fetcher: fakeFetch() }), /MISSING_EDITION_en/);
});

test('caps retries so no unbounded API or site polling is possible', async () => {
  await assert.rejects(verifyPublishedArticle(article, { fetcher: fakeFetch(), retries: 4 }), /RETRY_LIMIT/);
});
