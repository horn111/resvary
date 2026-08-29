import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const exportsToCheck = [
  ['@resvary/sdk', 'CreditLedger'],
  ['@resvary/sdk/credits', 'InMemoryCreditStore'],
  ['@resvary/sdk/receipts', 'PersistentReceiptLedger'],
  ['@resvary/sqlite', 'createSqliteCreditStore'],
  ['@resvary/circle', 'GatewayNanopaymentFunding'],
  ['@resvary/postgres', 'createPostgresCreditStore'],
  ['@resvary/worker', 'OutboxWorker'],
];

for (const [specifier, exportName] of exportsToCheck) {
  const module = await import(specifier);
  if (typeof module[exportName] !== 'function') {
    throw new Error(`${specifier} does not export ${exportName} as a function`);
  }
}

const cliFiles = [
  'packages/create-resvary/dist/index.js',
  'packages/postgres/dist/cli.js',
  'packages/worker/dist/cli.js',
];

for (const cliFile of cliFiles) {
  const absoluteCliFile = resolve(cliFile);
  const source = await readFile(absoluteCliFile, 'utf8');
  if (!source.startsWith('#!/usr/bin/env node')) {
    throw new Error(`${cliFile} is missing its Node.js shebang`);
  }
  const result = spawnSync(process.execPath, [absoluteCliFile, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: '', RESVARY_WEBHOOK_SECRET: '' },
  });
  if (result.status !== 0 || !result.stdout.includes('Usage:')) {
    throw new Error(`${cliFile} --help failed: ${result.stderr || result.stdout}`);
  }
}

console.log(
  `Package export smoke test passed (${exportsToCheck.length} exports, ${cliFiles.length} CLIs).`,
);
