const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function assertReleaseWorkflowContext({
  githubActions,
  githubRef,
  mode,
  releaseSha,
  workflowSha,
  consoleDigest,
}) {
  if (!githubActions) return;
  if (githubRef !== 'refs/heads/main') {
    throw new Error('Release workflows may run only from main');
  }
  if (!['dry_run', 'publish', 'reconcile'].includes(mode)) {
    throw new Error(`Unknown release mode ${JSON.stringify(mode)}`);
  }
  if (!shaPattern.test(workflowSha ?? '')) {
    throw new Error('GitHub workflow SHA is missing or invalid');
  }
  if (mode === 'publish' && releaseSha !== workflowSha) {
    throw new Error(
      'publish requires release_sha to equal the workflow main SHA; GitHub Actions cannot create a release tag on an older commit after workflow changes',
    );
  }
  if (mode === 'reconcile' && !digestPattern.test(consoleDigest ?? '')) {
    throw new Error('reconcile requires a full sha256 console_digest');
  }
}
