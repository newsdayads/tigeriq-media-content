# TigerIQ News Reader — offline full-article edition

**Product:** [index.html](./index.html) is one standalone file with the complete text of 32 already-published articles in Vietnamese, English and Spanish. Open or download it; no installation, AI provider, token, image CDN or paid service is required.

- Search all headlines, filter by category and sort by publication time.
- Change languages (VI / EN / ES). Open a story to read the **complete embedded** article, takeaways and source links offline.
- The Refresh button attempts a public JSON read from `newsdayads/tigeriq-media-content/main/content.json` and retains the offline snapshot if the request fails. External links need Internet.
- Snapshot `content.json` blob: `899043b6d4723763b34249556c414dd5f1707ee3`; latest publication: `2026-10-22T07:17:49.108Z`.
- Quality gate: `node --test tools/news-reader/reader.test.mjs` (GitHub Actions Offline News Reader Verify).

**Scope boundary:** This is an independently usable catalogue/reader, **not** the main live website and **not** proof that the K02 [hourly publishing Work Order](https://github.com/newsdayads/tigeriq-ai-lab/issues/4456) has succeeded. K02 still requires independently verified consecutive native scheduled hourly posts. No automatic CI green status can substitute for that acceptance.

**Maintenance:** This static HTML carries a pinned full-text snapshot. It can fetch newer public data on refresh; the bundled snapshot does not silently change after a publisher commit. Update the embedded JSON when deliberately refreshing the offline release. Never include credentials, billing actions or production deployment in this workflow.
