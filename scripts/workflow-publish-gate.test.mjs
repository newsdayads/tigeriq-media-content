import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const yaml = readFileSync(new URL('../.github/workflows/hourly-publisher.yml', import.meta.url), 'utf8');

test('NOOP cannot report a newly verified public article', () => {
  const commit = yaml.split('      - name: Commit article and original cover\n')[1]
    ?.split('      - name: Verify live article and original cover without AI provider calls\n')[0];
  const verify = yaml.split('      - name: Verify live article and original cover without AI provider calls\n')[1];
  assert.ok(commit, 'commit step must exist');
  assert.ok(verify, 'live verification step must exist');
  assert.match(commit, /^        id: publication$/m);
  assert.match(commit, /if git diff --cached --quiet; then[\s\S]*echo "published=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(commit, /git push[\s\S]*echo "published=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(verify, /^        if: steps\.publication\.outputs\.published == 'true'$/m);
});

test('publisher only executes on scheduled or manually dispatched runs', () => {
  assert.match(yaml, /publish:\n    if: github\.event_name != 'pull_request'/);
  assert.match(yaml, /cron: "17,47 \* \* \* \*"/);
  assert.match(yaml, /^      - scripts\/workflow-publish-gate\.test\.mjs$/m);
  assert.match(yaml, /run: node --test [^\n]*scripts\/workflow-publish-gate\.test\.mjs/);
});

test('PR checks cannot evict a pending scheduled or manually dispatched publisher', () => {
  assert.match(yaml, /^  group: hourly-ai-publisher-\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.number \|\| 'publish' \}\}$/m);
  assert.match(yaml, /^  cancel-in-progress: false$/m);
  assert.match(yaml, /^  schedule:$/m);
  assert.match(yaml, /^  workflow_dispatch:$/m);
});

// A semantic hourly schedule edit re-registers the GitHub Actions actor
// without increasing the cadence or changing minute 17 UTC.
test('refreshed schedule preserves two recovery windows per hour', () => {
  const cronLines = yaml.split('\n').filter(line => line.trim().startsWith('- cron:'));
  assert.deepEqual(cronLines, ['    - cron: "17,47 * * * *"']);
});

// Keep both jobs on a supported action runtime. GitHub Actions previously
// reported Node.js 20 deprecation warnings for the v4 action implementations.
test('publisher uses Node 24-native actions without implicit npm cache', () => {
  assert.equal([...yaml.matchAll(/^\s+- uses: actions\/checkout@v6$/gm)].length, 2);
  assert.equal([...yaml.matchAll(/^\s+- uses: actions\/setup-node@v6$/gm)].length, 2);
  assert.equal([...yaml.matchAll(/^\s+node-version: "24"$/gm)].length, 2);
  assert.equal([...yaml.matchAll(/^\s+package-manager-cache: false$/gm)].length, 2);
  assert.doesNotMatch(yaml, /actions\/(?:checkout|setup-node)@v[1-4]\b/);
});

// Cover-only or content-only PRs must run the existing read-only publishing
// checks; changing an editorial asset cannot silently skip the QA gate.
test('publication QA includes content-only and cover-only pull requests', () => {
  const paths = yaml.split('  pull_request:\n    paths:\n')[1]?.split('\npermissions:')[0];
  assert.ok(paths, 'pull_request path filter must exist');
  assert.match(paths, /^      - content\.json$/m);
  assert.match(paths, /^      - covers\/\*\*$/m);
  assert.match(paths, /^      - scripts\/hourly-publish\.mjs$/m);
  assert.match(yaml, /^    if: github\.event_name != 'pull_request'$/m,
    'a PR must NEVER run the publishing job');
});
