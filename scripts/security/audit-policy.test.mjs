import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudit, trivyExceptions } from './audit-policy.mjs';

const now = new Date('2026-09-21T00:00:00Z');
const exception = {
  advisory: 'GHSA-82x6-q7mm-w9cf',
  cve: 'CVE-2026-77465',
  package: 'toml',
  version: '3.0.0',
  path: 'node_modules/toml',
  owner: 'maintainer',
  expires: '2026-10-21',
  reason: 'Reviewed caller has no untrusted TOML input',
};
const policy = { schemaVersion: 1, exceptions: [exception] };
const lockfile = { packages: { 'node_modules/toml': { version: '3.0.0' } } };
const report = () => ({
  auditReportVersion: 2,
  vulnerabilities: {
    parent: { severity: 'high', via: ['toml'], nodes: ['node_modules/parent'] },
    toml: {
      severity: 'high',
      nodes: ['node_modules/toml'],
      via: [
        {
          severity: 'high',
          url: `https://github.com/advisories/${exception.advisory}`,
        },
      ],
    },
  },
  metadata: { vulnerabilities: { high: 2, critical: 0 } },
});

test('accepts only the reviewed advisory and its inherited parent risk', () => {
  const result = evaluateAudit(report(), lockfile, policy, now);
  assert.equal(result.accepted.length, 1);
  assert.deepEqual(result.failures, []);
});
test('blocks a new critical advisory on an excepted package', () => {
  const input = report();
  input.vulnerabilities.toml.via.push({
    severity: 'critical',
    url: 'https://github.com/advisories/GHSA-new-risk-here',
  });
  assert.equal(evaluateAudit(input, lockfile, policy, now).failures.length, 1);
});
test('does not extend an exception to another install path or version', () => {
  const input = report();
  input.vulnerabilities.toml.nodes.push('node_modules/other/node_modules/toml');
  assert.equal(evaluateAudit(input, lockfile, policy, now).failures.length, 1);
  assert.equal(
    evaluateAudit(
      report(),
      { packages: { 'node_modules/toml': { version: '3.0.1' } } },
      policy,
      now,
    ).failures.length,
    1,
  );
});
test('rejects expired exceptions at the UTC date boundary', () => {
  assert.throws(
    () => evaluateAudit(report(), lockfile, policy, new Date('2026-10-21T00:00:00Z')),
    /Expired/,
  );
  assert.throws(() => trivyExceptions(policy, new Date('2026-10-21T00:00:00Z')), /Expired/);
});
test('fails closed on a registry error, broken dependency reference, or summary', () => {
  assert.throws(
    () => evaluateAudit({ error: { code: 'E503' } }, lockfile, policy, now),
    /unsupported/,
  );
  const input = report();
  input.vulnerabilities.parent.via.push('missing');
  assert.throws(() => evaluateAudit(input, lockfile, policy, now), /Unresolved/);
  assert.throws(
    () => evaluateAudit({ ...report(), vulnerabilities: {} }, lockfile, policy, now),
    /Inconsistent/,
  );
});
test('blocks untraceable high risk instead of allowing an inherited package wholesale', () => {
  const input = report();
  input.vulnerabilities.parent.via = [];
  assert.equal(evaluateAudit(input, lockfile, policy, now).failures.length, 1);
});
test('image exceptions retain exact package version, IDs, reason and expiry', () => {
  const { vulnerabilities } = trivyExceptions(policy, now);
  assert.deepEqual(
    vulnerabilities.map(({ id }) => id),
    [exception.advisory, exception.cve],
  );
  for (const item of vulnerabilities) {
    assert.deepEqual(item.purls, ['pkg:npm/toml@3.0.0']);
    assert.equal(item.expired_at, exception.expires);
    assert.match(item.statement, /maintainer/);
    assert.equal(item.paths, undefined);
  }
});
