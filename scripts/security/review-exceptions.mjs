import { readFile } from 'node:fs/promises';
import { validatePolicy } from './audit-policy.mjs';

const policy = JSON.parse(
  await readFile(new URL('../../security/dependency-exceptions.json', import.meta.url), 'utf8'),
);
validatePolicy(policy);
const failures = [];
for (const exception of policy.exceptions) {
  const days = (Date.parse(`${exception.expires}T00:00:00Z`) - Date.now()) / 86_400_000;
  if (days <= 3)
    failures.push(
      `${exception.advisory}: review due within three days (${exception.expires}), owner ${exception.owner}`,
    );
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(exception.package)}/latest`,
    { signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) throw new Error(`Registry lookup failed for ${exception.package}`);
  const { version } = await response.json();
  if (version !== exception.version)
    failures.push(
      `${exception.package}: upstream ${version} is available; review the ${exception.version} exception`,
    );
  console.log(
    `${exception.advisory}: ${exception.package}@${exception.version}; upstream ${version}; expires ${exception.expires}`,
  );
}
if (failures.length) throw new Error(failures.join('\n'));
