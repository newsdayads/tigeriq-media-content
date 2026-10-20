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
  assert.match(commit, /\n        id: publication\n/);
  assert.match(commit, /if git diff --cached --quiet; then[\s\S]*echo "published=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(commit, /git push[\s\S]*echo "published=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(verify, /\n        if: steps\.publication\.outputs\.published == 'true'\n/);
});

test('publisher only executes on scheduled or manually dispatched runs', () => {
  assert.match(yaml, /publish:\n    if: github\.event_name != 'pull_request'/);
  assert.match(yaml, /cron: "17 \* \* \* \*"/);
});
