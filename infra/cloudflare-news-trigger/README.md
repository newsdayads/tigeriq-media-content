# TigerIQ News hourly trigger (cloud-only fallback)

## Purpose
GitHub-native `schedule` events were absent after the successful publication
run [39416809063](https://github.com/newsdayads/tigeriq-media-content/actions/runs/39416809063).
This **separate Cloudflare Workers Free Cron Trigger** calls the existing GitHub
`workflow_dispatch` once per UTC hour at minute 17. It does not move or use
the Gemini key; the publisher still runs inside GitHub Actions with its own
GitHub-hosted secret. It is a genuine hosted hourly trigger, not a ChatGPT task.

## Deployment gate (not completed by merging source)
1. Use the Owner-authorized Cloudflare account on **Workers Free** and verify
   the plan/quota are still zero-cost before deployment. Free Workers currently
   allow 5 Cron Triggers/account (vendor limits may change).
2. Owner/Work must securely create a **fine-grained GitHub token** restricted
   **only** to `newsdayads/tigeriq-media-content` with **Actions: Read & Write**
   (and only metadata implicit read). Do not use an already-exposed token.
   Store it exclusively as the Cloudflare Worker encrypted secret
   `GITHUB_ACTIONS_TOKEN` using `wrangler secret put`. Never commit,
   paste into chat, log, or echo this token.
3. From `infra/cloudflare-news-trigger`, deploy with Cloudflare Wrangler
   under the authorized account. The Worker has **no HTTP fetch endpoint**
   (`workers_dev=false`), and **one hourly cron** `17 * * * *`.
4. Confirm Cloudflare Scheduled event log `CLOUD_CRON_DISPATCH_ACCEPTED`,
   the GitHub `workflow_dispatch` run with `inputs.scheduler=cloudflare`,
   and publication commit + public VI/EN/ES + cover. **Dispatch HTTP 204 is
   only queue acceptance**, never publication PASS. Check two consecutive
   hours to accept K02.
5. GitHub's own schedule remains as backup. The publisher contains the
   `NEWS_HOURLY_PUBLISH_LIMIT=true` guard to prevent generating a second
   story for a UTC hour when both triggers fire; GitHub job concurrency is
   serialized by existing `publish` group.
6. Token revocation and Worker disable are the emergency kill switches.

## Tests
`node --test infra/cloudflare-news-trigger/cron.test.mjs`
Tests never make live GitHub requests or use production credentials.

**Not production ready until Owner-authenticated Cloudflare deployment,
scoped secret, scheduler logs, and two hourly real publications are verified.**
