const blockingSeverities = new Set(['high', 'critical']);

export function validatePolicy(policy, now = new Date()) {
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.exceptions)) {
    throw new Error('Unsupported dependency exception policy');
  }
  const identities = new Set();
  for (const exception of policy.exceptions) {
    const { advisory, cve, package: name, version, path, owner, reason, expires } = exception;
    if (
      !/^GHSA-[\w-]+$/.test(advisory ?? '') ||
      !/^CVE-\d{4}-\d+$/.test(cve ?? '') ||
      !name ||
      !version ||
      !path?.startsWith('node_modules/') ||
      !owner ||
      !reason ||
      !/^\d{4}-\d{2}-\d{2}$/.test(expires ?? '') ||
      !Number.isFinite(Date.parse(expires))
    )
      throw new Error('Incomplete dependency exception');
    if (now.getTime() >= Date.parse(`${expires}T00:00:00Z`)) {
      throw new Error(`Expired dependency exception: ${advisory} (${expires})`);
    }
    const identity = `${advisory}:${path}:${version}`;
    if (identities.has(identity)) throw new Error(`Duplicate exception: ${identity}`);
    identities.add(identity);
  }
}

export function evaluateAudit(report, lockfile, policy, now = new Date()) {
  validatePolicy(policy, now);
  if (
    report?.error ||
    report?.auditReportVersion !== 2 ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities) ||
    !report.metadata?.vulnerabilities ||
    !lockfile?.packages
  )
    throw new Error('Missing or unsupported npm audit/lockfile data');

  const failures = [];
  const accepted = [];
  const entries = report.vulnerabilities;
  const hasBlockingSource = (name, seen = new Set()) => {
    if (seen.has(name)) return false;
    const entry = entries[name];
    if (!entry || !Array.isArray(entry.via)) {
      throw new Error(`Unresolved advisory dependency: ${name}`);
    }
    const next = new Set([...seen, name]);
    // Inspect every edge, including malformed edges after a known advisory.
    return entry.via
      .map((via) =>
        typeof via === 'string'
          ? hasBlockingSource(via, next)
          : blockingSeverities.has(via?.severity),
      )
      .some(Boolean);
  };

  for (const [name, entry] of Object.entries(entries)) {
    if (!Array.isArray(entry.via) || !Array.isArray(entry.nodes)) {
      throw new Error(`Malformed audit entry: ${name}`);
    }
    if (blockingSeverities.has(entry.severity) && !hasBlockingSource(name)) {
      failures.push(`${name}: high/critical risk without a traceable advisory`);
    }
    for (const via of entry.via) {
      if (typeof via === 'string' || !blockingSeverities.has(via?.severity)) continue;
      const advisory = via.url?.match(/\/(GHSA-[\w-]+)$/)?.[1];
      if (!advisory || entry.nodes.length === 0) {
        failures.push(`${name}: unrecognized high/critical advisory`);
        continue;
      }
      for (const path of entry.nodes) {
        const version = lockfile.packages[path]?.version;
        const exception = policy.exceptions.find(
          (candidate) =>
            candidate.advisory === advisory &&
            candidate.package === name &&
            candidate.path === path &&
            candidate.version === version,
        );
        const identity = `${advisory} ${name}@${version ?? 'unknown'} (${path})`;
        if (exception) accepted.push(`${identity}; review before ${exception.expires}`);
        else failures.push(identity);
      }
    }
  }
  const reportedBlocking =
    report.metadata.vulnerabilities.high + report.metadata.vulnerabilities.critical;
  if (
    !Number.isFinite(reportedBlocking) ||
    (reportedBlocking > 0 && !accepted.length && !failures.length)
  ) {
    throw new Error('Inconsistent npm audit severity summary');
  }
  return { failures, accepted };
}

export function trivyExceptions(policy, now = new Date()) {
  validatePolicy(policy, now);
  return {
    vulnerabilities: policy.exceptions.flatMap((exception) =>
      [exception.advisory, exception.cve].map((id) => ({
        id,
        purls: [`pkg:npm/${exception.package}@${exception.version}`],
        expired_at: `${exception.expires}T00:00:00Z`,
        statement: `${exception.owner}: ${exception.reason}`,
      })),
    ),
  };
}
