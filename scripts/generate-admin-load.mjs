import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteCreditStore } from '@resvary/sqlite';

const output = resolve(value('--output') ?? '.resvary/admin-load.sqlite');
const customerCount = integer('--customers', 10_000);
const activityCount = integer('--activity', 1_000_000);
const projectId = value('--project') ?? 'load_profile';

await mkdir(dirname(output), { recursive: true });
await rm(output, { force: true });
const store = createSqliteCreditStore({ path: output });
store.close();

const database = new DatabaseSync(output);
database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; BEGIN IMMEDIATE;');
const insertAccount = database.prepare(`
  INSERT INTO resvary_credit_accounts
    (id, project_id, customer_id, posted_units, reserved_units, created_at, updated_at, payload)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertLedger = database.prepare(`
  INSERT INTO resvary_ledger_entries
    (id, account_id, project_id, customer_id, entry_type, delta_units, created_at, payload)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const now = Date.now();
for (let index = 0; index < customerCount; index += 1) {
  const customerId = `customer_${String(index).padStart(6, '0')}`;
  const accountId = `account_${String(index).padStart(6, '0')}`;
  const createdAt = now - 90 * 86_400_000 + index;
  const account = {
    id: accountId,
    projectId,
    customerId,
    currency: 'USD',
    postedUnits: '100000000',
    reservedUnits: '0',
    availableUnits: '100000000',
    postedAmount: '100',
    reservedAmount: '0',
    availableAmount: '100',
    createdAt,
    updatedAt: now - (index % 2_592_000_000),
  };
  insertAccount.run(
    accountId,
    projectId,
    customerId,
    account.postedUnits,
    account.reservedUnits,
    account.createdAt,
    account.updatedAt,
    JSON.stringify(account),
  );
}

for (let index = 0; index < activityCount; index += 1) {
  const customerIndex = index % customerCount;
  const customerId = `customer_${String(customerIndex).padStart(6, '0')}`;
  const accountId = `account_${String(customerIndex).padStart(6, '0')}`;
  const id = `ledger_${String(index).padStart(9, '0')}`;
  const createdAt = now - (activityCount - index);
  const entry = {
    id,
    accountId,
    projectId,
    customerId,
    type: 'charge',
    bucket: 'posted',
    deltaUnits: '-1000',
    balanceAfterUnits: '99999000',
    referenceType: 'usage_receipt',
    referenceId: `receipt_${String(index).padStart(9, '0')}`,
    createdAt,
  };
  insertLedger.run(
    id,
    accountId,
    projectId,
    customerId,
    entry.type,
    entry.deltaUnits,
    createdAt,
    JSON.stringify(entry),
  );
}
database.exec('COMMIT; PRAGMA optimize;');
database.close();

process.stdout.write(
  `${JSON.stringify({ output, projectId, customerCount, activityCount }, null, 2)}\n`,
);

function value(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function integer(flag, fallback) {
  const result = Number(value(flag) ?? fallback);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${flag} must be positive`);
  return result;
}
