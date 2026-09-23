import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { evaluateAudit, trivyExceptions } from './audit-policy.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const policy = await readJson('../../security/dependency-exceptions.json');
const lockfile = await readJson('../../package-lock.json');
// Use the same npm executable as the invoking npm script, without a shell.
if (!process.env.npm_execpath) throw new Error('Run this gate with npm run audit:production');
const audit = spawnSync(
  process.execPath,
  [process.env.npm_execpath, 'audit', '--omit=dev', '--json'],
  {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  },
);
if (audit.error || ![0, 1].includes(audit.status)) {
  throw new Error(`npm audit could not complete: ${audit.error?.message ?? audit.stderr}`);
}
const report = JSON.parse(audit.stdout);
await mkdir(new URL('../../.resvary/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../../.resvary/npm-audit.json', import.meta.url),
  JSON.stringify(report, null, 2),
);
const result = evaluateAudit(report, lockfile, policy);
for (const accepted of result.accepted) console.log(`Temporary exception: ${accepted}`);
if (result.failures.length) {
  throw new Error(`Unapproved high/critical advisories:\n${result.failures.join('\n')}`);
}
// JSON is valid YAML; one policy supplies npm and version-scoped image exceptions.
await writeFile(
  new URL('../../.resvary/agent-trivyignore.yaml', import.meta.url),
  JSON.stringify(trivyExceptions(policy), null, 2),
);
console.log(
  `Production dependency gate passed (${result.accepted.length} temporary advisory exceptions).`,
);
