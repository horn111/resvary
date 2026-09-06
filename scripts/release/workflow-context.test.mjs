import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReleaseWorkflowContext } from './workflow-context.mjs';

const headSha = 'a'.repeat(40);
const olderSha = 'b'.repeat(40);
const digest = `sha256:${'c'.repeat(64)}`;

function context(overrides = {}) {
  return {
    githubActions: true,
    githubRef: 'refs/heads/main',
    mode: 'publish',
    releaseSha: headSha,
    workflowSha: headSha,
    consoleDigest: '',
    ...overrides,
  };
}

test('allows publish only for the workflow head commit', () => {
  assert.doesNotThrow(() => assertReleaseWorkflowContext(context()));
  assert.throws(
    () => assertReleaseWorkflowContext(context({ releaseSha: olderSha })),
    /publish requires release_sha to equal the workflow main SHA/,
  );
});

test('allows dry runs against an older main commit', () => {
  assert.doesNotThrow(() =>
    assertReleaseWorkflowContext(context({ mode: 'dry_run', releaseSha: olderSha })),
  );
});

test('requires an immutable image digest when reconciling an older release', () => {
  assert.doesNotThrow(() =>
    assertReleaseWorkflowContext(
      context({ mode: 'reconcile', releaseSha: olderSha, consoleDigest: digest }),
    ),
  );
  assert.throws(
    () =>
      assertReleaseWorkflowContext(
        context({ mode: 'reconcile', releaseSha: olderSha, consoleDigest: 'latest' }),
      ),
    /reconcile requires a full sha256 console_digest/,
  );
});

test('rejects release workflows dispatched outside main', () => {
  assert.throws(
    () => assertReleaseWorkflowContext(context({ githubRef: 'refs/heads/feature' })),
    /only from main/,
  );
});
