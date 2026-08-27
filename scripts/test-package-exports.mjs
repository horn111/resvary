import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
  const source = await readFile(resolve(cliFile), 'utf8');
  if (!source.startsWith('#!/usr/bin/env node')) {
    throw new Error(`${cliFile} is missing its Node.js shebang`);
  }
}

console.log(
  `Package export smoke test passed (${exportsToCheck.length} exports, ${cliFiles.length} CLIs).`,
);
