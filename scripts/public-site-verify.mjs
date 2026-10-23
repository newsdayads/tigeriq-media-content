import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const LIVE_ORIGIN = 'https://tigeriq-media.vercel.app';
const COVER_PREFIX = 'https://raw.githubusercontent.com/newsdayads/tigeriq-media-content/main/covers/';
const LANGUAGES = ['vi', 'en', 'es'];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_LIVE_VERIFY_ATTEMPTS = 20;
const LIVE_PROPAGATION_WINDOW_MS = 90_000;

// A newly pushed article may briefly return 404 or an older cached page.
// Permanent permission/identity failures must not trigger repeated requests.
function isTransientLiveFailure(error) {
  const message = String(error?.message || '');
  return /^(?:LIVE_VERIFY_HTTP_(?:404|429|500|502|503|504)|LIVE_VERIFY_STALE_OR_MISSING_CONTENT)$/.test(message)
    || error?.name === 'TimeoutError' || error?.name === 'AbortError'
    || error?.name === 'TypeError';
}

// The current publisher places the first 70 Unicode code points of the English
// headline in the SVG's first <title>. A valid SVG from an unrelated article
// must not pass publication verification merely by being renamed to this slug.
function expectedCoverTitle(title) {
  return [...title].slice(0, 70).join('')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function matchesTitle(html, title) {
  const escaped = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  return html.includes(title) || html.includes(escaped);
}

function checkInput(article) {
  if (!article || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug || '')) {
    throw new Error('LIVE_VERIFY_INVALID_SLUG');
  }
  const cover = article.cover?.url;
  if (typeof cover !== 'string' || !cover.startsWith(COVER_PREFIX) ||
      !cover.endsWith(`/${article.slug}.svg`) || cover.includes('?')) {
    throw new Error('LIVE_VERIFY_UNTRUSTED_COVER');
  }
  for (const lang of LANGUAGES) {
    if (typeof article.editions?.[lang]?.title !== 'string' || !article.editions[lang].title.trim()) {
      throw new Error(`LIVE_VERIFY_MISSING_EDITION_${lang}`);
    }
  }
  return cover;
}

async function checkedGet(url, fetcher) {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (response.status !== 200) throw new Error(`LIVE_VERIFY_HTTP_${response.status}`);
  return response.text();
}

export async function verifyPublishedArticle(article, {
  fetcher = fetch, retries = MAX_LIVE_VERIFY_ATTEMPTS, delayMs = 5000,
  pauseImpl = pause, nowImpl = Date.now
} = {}) {
  const cover = checkInput(article);
  if (!Number.isInteger(retries) || retries < 1 || retries > MAX_LIVE_VERIFY_ATTEMPTS ||
      !Number.isFinite(delayMs) || delayMs < 0 || delayMs > 15_000) {
    throw new Error('LIVE_VERIFY_RETRY_LIMIT');
  }
  // One bounded wait budget covers all three languages: no infinite polling.
  const deadline = nowImpl() + LIVE_PROPAGATION_WINDOW_MS;
  const output = [];
  for (const lang of LANGUAGES) {
    const url = `${LIVE_ORIGIN}/${lang}/article/${article.slug}`;
    let error;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const html = await checkedGet(url, fetcher);
        if (!html.includes(`<html lang="${lang}"`) || !matchesTitle(html, article.editions[lang].title)
            || !html.includes(cover)) throw new Error('LIVE_VERIFY_STALE_OR_MISSING_CONTENT');
        output.push({ locale: lang, url, status: 200 });
        error = null;
        break;
      } catch (failure) {
        error = failure;
        if (attempt >= retries || !isTransientLiveFailure(failure) ||
            nowImpl() + delayMs > deadline) break;
        await pauseImpl(delayMs);
      }
    }
    if (error) throw new Error(`LIVE_VERIFY_${lang}_FAILED: ${error.message}`);
  }
  const image = await checkedGet(cover, fetcher);
  if (!/^\s*<svg\b[\s\S]*<\/svg>\s*$/.test(image)) throw new Error('LIVE_VERIFY_COVER_INVALID_SVG');
  const imageTitle = image.match(/^\s*<svg\b[^>]*><title id="title">([^<]*)<\/title>/)?.[1];
  if (imageTitle !== expectedCoverTitle(article.editions.en.title)) {
    throw new Error('LIVE_VERIFY_COVER_TITLE_MISMATCH');
  }
  return { slug: article.slug, editions: output, cover, coverStatus: 200 };
}

async function main() {
  const content = JSON.parse(await readFile(new URL('../content.json', import.meta.url), 'utf8'));
  const newest = content.articles?.[0];
  const evidence = await verifyPublishedArticle(newest);
  console.log('TIGERIQ_LIVE_PUBLICATION_VERIFIED ' + JSON.stringify(evidence));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error('TIGERIQ_LIVE_PUBLICATION_FAILED ' + error.message); process.exitCode = 1; });
}
