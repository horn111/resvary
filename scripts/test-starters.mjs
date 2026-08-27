import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const generatorUrl = pathToFileURL(
  resolve(import.meta.dirname, '../packages/create-resvary/dist/generator.js'),
).href;
const { generateProject } = await import(generatorUrl);
const root = await mkdtemp(join(tmpdir(), 'resvary-starters-'));
const originalDirectory = process.cwd();
const variants = [
  { projectName: 'express-sqlite', framework: 'express', database: 'sqlite' },
  { projectName: 'express-postgres', framework: 'express', database: 'postgres' },
  { projectName: 'next-sqlite', framework: 'next', database: 'sqlite' },
  { projectName: 'next-postgres', framework: 'next', database: 'postgres' },
];

try {
  process.chdir(root);
  for (const variant of variants) {
    await generateProject({
      ...variant,
      template: 'ai-credits',
      pricing: 'request',
      payTo: '0x0000000000000000000000000000000000000000',
    });
  }
  process.chdir(originalDirectory);

  const results = await Promise.allSettled(
    variants.map(async ({ projectName }) => {
      const projectDirectory = join(root, projectName);
      await runNpm(['install', '--no-audit', '--no-fund'], projectDirectory);
      await runNpm(['run', 'build'], projectDirectory);
      process.stdout.write(`Starter build passed: ${projectName}\n`);
    }),
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `${failures.length} starter build(s) failed`,
    );
  }
} finally {
  process.chdir(originalDirectory);
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function runNpm(args, cwd) {
  const windows = process.platform === 'win32';
  const command = windows ? process.env.ComSpec : 'npm';
  const commandArgs = windows ? ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`] : args;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, npm_config_cache: join(root, '.npm-cache') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`npm ${args.join(' ')} failed in ${cwd}\n${output}`));
    });
  });
}
