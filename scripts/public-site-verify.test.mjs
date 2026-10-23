import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPublishedArticle } from './public-site-verify.mjs';
import { coverSvg } from './hourly-publish.mjs';

const slug = 'example-ai-story';
const cover = 'https://raw.githubusercontent.com/newsdayads/tigeriq-media-content/main/covers/example-ai-story.svg';
const article = { slug, cover: { url: cover }, editions: {
  vi: { title: 'Tin AI mới' }, en: { title: 'New AI story' }, es: { title: 'Nueva historia IA' }
} };
const htmlByLang = Object.fromEntries(Object.entries(article.editions).map(([lang, data]) =>
  [lang, `<html lang="${lang}"><main><h1>${data.title}</h1><img src="${cover}"></main></html>`]));
function fakeFetch({ mutate = (x) => x, coverBody = coverSvg(article.editions.en.title), coverStatus = 200 } = {}) {
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

test('caps attempts so no unbounded API or site polling is possible', async () => {
  await assert.rejects(verifyPublishedArticle(article, { fetcher: fakeFetch(), retries: 21 }), /RETRY_LIMIT/);
});

test('a newly committed live story can pass after four temporary 404s without changing acceptance rules', async () => {
  let viGets = 0;
  const base = fakeFetch();
  const fetcher = async (url, options) => {
    if (new URL(url).pathname.startsWith('/vi/article/')) {
      viGets++;
      if (viGets <= 4) return { status: 404, text: async () => 'not yet deployed' };
    }
    return base(url, options);
  };
  const result = await verifyPublishedArticle(article, { fetcher, retries: 6, delayMs: 0 });
  assert.equal(viGets, 5);
  assert.deepEqual(result.editions.map(x => x.locale), ['vi', 'en', 'es']);
  assert.equal(result.coverStatus, 200);
});

test('temporarily stale 200 article HTML must converge before it can pass', async () => {
  let viGets = 0;
  const base = fakeFetch();
  const fetcher = async (url, options) => {
    if (new URL(url).pathname.startsWith('/vi/article/') && ++viGets <= 4) {
      return { status: 200, text: async () => '<html lang="vi"><h1>old cached story</h1></html>' };
    }
    return base(url, options);
  };
  await verifyPublishedArticle(article, { fetcher, retries: 6, delayMs: 0 });
  assert.equal(viGets, 5);
});

test('permanent 403 must fail fast rather than polling until timeout', async () => {
  let calls = 0;
  await assert.rejects(verifyPublishedArticle(article, {
    fetcher: async () => { calls++; return { status: 403, text: async () => 'forbidden' }; },
    retries: 20, delayMs: 0
  }), /LIVE_VERIFY_vi_FAILED: LIVE_VERIFY_HTTP_403/);
  assert.equal(calls, 1);
});

test('post-commit propagation has a shared 90-second wait budget, not unlimited polling', async () => {
  let now = 0;
  let viGets = 0;
  await assert.rejects(verifyPublishedArticle(article, {
    fetcher: async () => { viGets++; return { status: 404, text: async () => 'not deployed' }; },
    retries: 20, delayMs: 15_000,
    nowImpl: () => now,
    pauseImpl: async (ms) => { now += ms; }
  }), /LIVE_VERIFY_vi_FAILED: LIVE_VERIFY_HTTP_404/);
  assert.equal(now, 90_000);
  assert.equal(viGets, 7);
});


test('a 200 SVG from another article must fail even if its URL matches the slug', async () => {
  await assert.rejects(verifyPublishedArticle(article, {
    fetcher: fakeFetch({ coverBody: coverSvg('Entirely different article title') }), retries: 1
  }), /LIVE_VERIFY_COVER_TITLE_MISMATCH/);
});

test('exact signed editorial headline with escaped XML matches real cover generator', async () => {
  const named = { ...article, editions: {
    ...article.editions, en: { title: 'AI & "Cloud" <Hardware> Launch - '+ 'a'.repeat(90) }
  } };
  const fetcher = async (url) => url === cover
    ? { status: 200, text: async () => coverSvg(named.editions.en.title) }
    : { status: 200, text: async () =>
        '<html lang="'+new URL(url).pathname.split('/')[1]+'"><h1>'+
        (named.editions[new URL(url).pathname.split('/')[1]].title)+'</h1>'+
        cover+'</html>' };
  const result = await verifyPublishedArticle(named, { fetcher, retries: 1 });
  assert.equal(result.coverStatus, 200);
});

test('an XML comment containing the expected title cannot spoof SVG identity', async () => {
  const actual = coverSvg('Another article');
  const injected = actual.replace('<title id="title">',
    '<!-- <title id="title">'+article.editions.en.title+'</title> -->'+'<title id="title">');
  await assert.rejects(verifyPublishedArticle(article, {
    fetcher: fakeFetch({ coverBody: injected }), retries: 1
  }), /LIVE_VERIFY_COVER_TITLE_MISMATCH/);
});

test('wrong displayed article never verifies just because sidebar or metadata mentions the expected headline', async () => {
  const altered = (html) => html.replace(
    '<h1>Tin AI mới</h1>',
    '<h1>Stale cached story</h1><aside>Tin AI mới</aside><meta content="Tin AI mới">'
  );
  await assert.rejects(verifyPublishedArticle(article, {
    fetcher: fakeFetch({ mutate: altered }), retries: 1
  }), /LIVE_VERIFY_vi_FAILED: LIVE_VERIFY_STALE_OR_MISSING_CONTENT/);
});

test('HTML comment and script cannot spoof an H1 from a different article', async () => {
  const altered = (html) => html.replace(
    '<h1>Tin AI mới</h1>',
    '<h1>Stale cached story</h1><!-- <h1>Tin AI mới</h1> -->' +
    '<script>const fakeHeading = "<h1>Tin AI mới</h1>";</script>'
  );
  await assert.rejects(verifyPublishedArticle(article, {
    fetcher: fakeFetch({ mutate: altered }), retries: 1
  }), /LIVE_VERIFY_vi_FAILED: LIVE_VERIFY_STALE_OR_MISSING_CONTENT/);
});

test('genuine nested H1 with HTML-escaped headline still passes all live publication guards', async () => {
  const named = { ...article, editions: { ...article.editions,
    en: { title: 'AI & "Cloud" launches' }
  }};
  const fetcher = async (url) => {
    if (url === cover) return { status: 200, text: async () => coverSvg(named.editions.en.title) };
    const lang = new URL(url).pathname.split('/')[1];
    const title = lang === 'en'
      ? 'AI &amp; &quot;Cloud&quot; launches'
      : named.editions[lang].title;
    return { status: 200, text: async () =>
      '<html lang="' + lang + '"><main><h1><span>' + title +
      '</span></h1><img src="' + cover + '"></main></html>' };
  };
  const result = await verifyPublishedArticle(named, { fetcher, retries: 1 });
  assert.deepEqual(result.editions.map(x => x.locale), ['vi', 'en', 'es']);
  assert.equal(result.coverStatus, 200);
});
