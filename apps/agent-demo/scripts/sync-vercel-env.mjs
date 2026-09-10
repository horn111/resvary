import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Operator command: secrets travel only through child stdin, never CLI arguments or logs.
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(app, '../..');
const cli = process.argv[2];
if (!cli) throw new Error('Pass the path to vercel/dist/index.js');
const project = JSON.parse(readFileSync(resolve(app, '.vercel/project.json'), 'utf8'));
if (project.projectName !== 'resvary-agent-demo')
  throw new Error('Link the separate resvary-agent-demo project first');
const source = {
  ...parseEnv(readFileSync(resolve(root, '.env.agent-demo.local'), 'utf8')),
  ...parseEnv(readFileSync(resolve(root, '.env.circle-session.local'), 'utf8')),
};
source.NOUS_API_KEY ||= source.NOUS;
source.HYPERBOLIC_API_KEY ||= source.HYPERBOLIC;
source.CRON_SECRET ||= source.AGENT_DEMO_SECRET;
if ((source.AGENT_DEMO_SECRET?.length ?? 0) < 32 || (source.CRON_SECRET?.length ?? 0) < 32)
  throw new Error('Application and maintenance secrets must contain at least 32 characters');
const publicNames = [
  'AGENT_DEMO_ORIGIN',
  'AGENT_DEMO_PAYER',
  'AGENT_DEMO_SELLER',
  'AGENT_DEMO_WALLET',
  'AGENT_DEMO_ACCEPTING',
  'AGENT_DEMO_TEST_MODE',
  'AGENT_DEMO_INITIAL_SPEND_UNITS',
  'AGENT_DEMO_EXECUTION_MODE',
  'AGENT_DEMO_AGENT_PROVIDER',
  'AGENT_DEMO_AGENT_MODEL',
  'AGENT_DEMO_ANALYSIS_PROVIDER',
  'AGENT_DEMO_ANALYSIS_MODEL',
];
const secretNames = [
  'AGENT_DEMO_SECRET',
  'CIRCLE_AGENT_SESSION_BUNDLE',
  'CIRCLE_SESSION_ENCRYPTION_KEY',
  'CRON_SECRET',
];
const providers = new Set([source.AGENT_DEMO_AGENT_PROVIDER, source.AGENT_DEMO_ANALYSIS_PROVIDER]);
for (const provider of providers) {
  if (!['openai', 'hyperbolic', 'nous'].includes(provider))
    throw new Error('Select supported providers first');
  secretNames.push(`${provider.toUpperCase()}_API_KEY`);
}
if (source.AGENT_DEMO_TEST_MODE !== 'false' || source.AGENT_DEMO_EXECUTION_MODE !== 'workflow')
  throw new Error('Vercel requires live dependencies and workflow mode');
for (const name of [...publicNames, ...secretNames]) {
  if (!source[name]?.trim()) throw new Error(`Missing ${name}`);
}
for (const name of [...publicNames, ...secretNames]) {
  await new Promise((ok, fail) => {
    const args = [
      cli,
      'env',
      'add',
      name,
      'production',
      '--force',
      '--yes',
      '--project',
      project.projectId,
      '--scope',
      project.orgId,
      secretNames.includes(name) ? '--sensitive' : '--no-sensitive',
    ];
    const child = spawn(process.execPath, args, {
      cwd: app,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
    child.on('error', () => fail(new Error(`Could not upload ${name}`)));
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`Vercel rejected ${name}`))));
    child.stdin.end(source[name].trim());
  });
  console.log(`Configured ${name}`);
}
