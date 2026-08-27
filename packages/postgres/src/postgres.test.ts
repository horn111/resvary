import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { CreditLedger } from '@resvary/sdk/credits';
import {
  PersistentReceiptLedger,
  PersistentWebhookInbox,
  createWatcherCursorKey,
  createWebhookEvent,
  signWebhookEvent,
  serializeReceiptStoreValue,
} from '@resvary/sdk/receipts';
import { createPostgresCreditStore } from './credit.js';
import { applyV1, migratePostgres } from './migrations.js';
import { createPostgresReceiptStore } from './receipt.js';
import { importSqliteDatabase, verifySqliteImport } from './import-sqlite.js';

const connectionString = process.env.TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;

describe('Postgres configuration', () => {
  it('rejects unsafe connection and retry configuration before opening a pool', () => {
    expect(() =>
      createPostgresCreditStore({ connectionString: 'postgres://example', schema: 'bad-schema' }),
    ).toThrow('Invalid Postgres schema');
    expect(() =>
      createPostgresCreditStore({
        connectionString: 'postgres://example',
        maxTransactionRetries: -1,
      }),
    ).toThrow('non-negative integer');
  });
});

suite('Postgres stores', () => {
  const schema = `resvary_test_${randomUUID().replaceAll('-', '')}`;
  const pool = connectionString ? new Pool({ connectionString }) : undefined;

  beforeAll(async () => {
    await migratePostgres({ pool: pool!, schema });
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  it('applies schema migrations idempotently', async () => {
    const status = await migratePostgres({ pool: pool!, schema });
    expect(status).toMatchObject({ currentVersion: 2, latestVersion: 2, pendingVersions: [] });
  });

  it('upgrades a version 1 schema sequentially', async () => {
    const upgradeSchema = `resvary_upgrade_${randomUUID().replaceAll('-', '')}`;
    const client = await pool!.connect();
    try {
      await client.query(`CREATE SCHEMA "${upgradeSchema}"`);
      await client.query(`
        CREATE TABLE "${upgradeSchema}".resvary_schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at BIGINT NOT NULL
        )
      `);
      await applyV1(client, upgradeSchema);
      const status = await migratePostgres({ pool: pool!, schema: upgradeSchema });
      expect(status).toMatchObject({ currentVersion: 2, latestVersion: 2, pendingVersions: [] });
      const constraint = await pool!.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'resvary_outbox_events_status'
             AND conrelid = '"${upgradeSchema}".resvary_outbox_events'::regclass
         ) AS exists`,
      );
      expect(constraint.rows[0]?.exists).toBe(true);
    } finally {
      client.release();
      await pool!.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`);
    }
  });

  it('serializes reservations across independent store instances', async () => {
    const firstStore = createPostgresCreditStore({ pool: pool!, schema });
    const secondStore = createPostgresCreditStore({ pool: pool!, schema });
    const first = new CreditLedger({ projectId: 'project', store: firstStore });
    const second = new CreditLedger({ projectId: 'project', store: secondStore });
    await first.grantCredits({ customerId: 'customer', amount: '1', idempotencyKey: 'grant' });
    const meter = await first.registerMeter({
      key: 'jobs',
      dimensions: ['jobs'],
      idempotencyKey: 'meter',
    });
    const price = await first.createPriceVersion({
      meterKey: meter.key,
      rates: [{ dimension: 'jobs', unitSize: '1', amount: '0.75' }],
      idempotencyKey: 'price',
    });

    const results = await Promise.allSettled([
      first.reserveCredits({
        customerId: 'customer',
        priceId: price.id,
        estimatedUsage: { jobs: '1' },
        idempotencyKey: 'reserve-a',
      }),
      second.reserveCredits({
        customerId: 'customer',
        priceId: price.id,
        estimatedUsage: { jobs: '1' },
        idempotencyKey: 'reserve-b',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await first.getBalance('customer')).availableAmount).toBe('0.25');
  });

  it('claims disjoint outbox batches and persists receipts', async () => {
    const firstStore = createPostgresCreditStore({ pool: pool!, schema });
    const secondStore = createPostgresCreditStore({ pool: pool!, schema });
    const claimNow = Date.now();
    const [firstClaim, secondClaim] = await Promise.all([
      firstStore.claimOutboxEvents({
        workerId: 'worker-a',
        now: claimNow,
        leaseMs: 30_000,
        limit: 10,
      }),
      secondStore.claimOutboxEvents({
        workerId: 'worker-b',
        now: claimNow,
        leaseMs: 30_000,
        limit: 10,
      }),
    ]);
    const ids = [...firstClaim, ...secondClaim].map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    const originalClaim = [...firstClaim, ...secondClaim][0]!;
    const replacementClaims = await firstStore.claimOutboxEvents({
      workerId: originalClaim.leaseOwner!,
      now: claimNow + 31_000,
      leaseMs: 30_000,
      limit: 100,
    });
    const replacementClaim = replacementClaims.find((event) => event.id === originalClaim.id)!;
    await expect(
      firstStore.completeOutboxEvent(
        originalClaim.id,
        originalClaim.leaseOwner!,
        claimNow + 31_001,
        originalClaim.attemptCount,
      ),
    ).rejects.toThrow('lease lost');
    await firstStore.completeOutboxEvent(
      replacementClaim.id,
      replacementClaim.leaseOwner!,
      claimNow + 31_002,
      replacementClaim.attemptCount,
    );

    const receipts = createPostgresReceiptStore({ pool: pool!, schema });
    const receiptLedger = new PersistentReceiptLedger({ store: receipts });
    const invoice = await receiptLedger.createInvoice({
      id: 'invoice_pg',
      amount: '1',
      payTo: '0x1111111111111111111111111111111111111111',
    });
    const receipt = await receiptLedger.recordPayment(invoice.id, {
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      from: '0x2222222222222222222222222222222222222222',
      to: invoice.payTo,
      amount: invoice.amount,
      memo: invoice.memo,
      blockNumber: 12n,
    });
    const event = createWebhookEvent('invoice.paid', { invoice, receipt }, 1_700_000_000_000);
    const inbox = new PersistentWebhookInbox({ store: receipts });
    const delivery = await inbox.receive({
      payload: event,
      header: signWebhookEvent(event, 'secret', 1_700_000_000).header,
      secret: 'secret',
      now: 1_700_000_000,
    });
    const cursorKey = createWatcherCursorKey({
      network: invoice.network,
      invoiceId: invoice.id,
      memoId: invoice.memoId,
    });
    await receipts.saveWatcherCursor({
      key: cursorKey,
      network: invoice.network,
      invoiceId: invoice.id,
      memoId: invoice.memoId,
      nextFromBlock: 13n,
      updatedAt: 1_700_000_001_000,
    });

    expect((await receipts.getInvoice(invoice.id))?.status).toBe('paid');
    expect((await receipts.getReceipt(receipt.id))?.blockNumber).toBe(12n);
    expect((await receipts.getWebhookDelivery(delivery.id))?.attempt).toBe(1);
    expect((await receipts.getWatcherCursor(cursorKey))?.nextFromBlock).toBe(13n);

    const concurrentInvoice = await receiptLedger.createInvoice({
      id: 'invoice_pg_concurrent',
      amount: '2',
      payTo: invoice.payTo,
    });
    const payment = {
      txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
      from: '0x2222222222222222222222222222222222222222' as const,
      to: concurrentInvoice.payTo,
      amount: concurrentInvoice.amount,
      memo: concurrentInvoice.memo,
    };
    const [concurrentA, concurrentB] = await Promise.all([
      new PersistentReceiptLedger({ store: receipts }).recordPayment(concurrentInvoice.id, payment),
      new PersistentReceiptLedger({ store: receipts }).recordPayment(concurrentInvoice.id, payment),
    ]);
    expect(concurrentB.id).toBe(concurrentA.id);
    const eventTypes = (await receipts.listWebhookEvents()).map((item) => item.type);
    expect(eventTypes.filter((type) => type === 'invoice.observed')).toHaveLength(2);
    expect(eventTypes.filter((type) => type === 'invoice.paid')).toHaveLength(2);

    const reusedInvoice = await receiptLedger.createInvoice({
      id: 'invoice_pg_reused_tx',
      amount: '2',
      payTo: invoice.payTo,
    });
    await expect(receiptLedger.recordPayment(reusedInvoice.id, payment)).rejects.toThrow(
      'already assigned',
    );
    await expect(receipts.getInvoice(reusedInvoice.id)).resolves.toMatchObject({ status: 'open' });
  });

  it('dry-runs, rolls back corruption, imports, and verifies a SQLite v2 fixture', async () => {
    const importSchema = `resvary_import_${randomUUID().replaceAll('-', '')}`;
    const directory = mkdtempSync(join(tmpdir(), 'resvary-import-'));
    const sqlitePath = join(directory, 'resvary-v2.sqlite');
    const account = {
      id: 'acct_import',
      projectId: 'project_import',
      customerId: 'customer_import',
      currency: 'USD',
      postedUnits: '1000000',
      reservedUnits: '0',
      availableUnits: '1000000',
      postedAmount: '1',
      reservedAmount: '0',
      availableAmount: '1',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    const ledgerEntry = {
      id: 'le_import',
      accountId: account.id,
      projectId: account.projectId,
      customerId: account.customerId,
      type: 'grant',
      bucket: 'posted',
      deltaUnits: '1000000',
      balanceAfterUnits: '1000000',
      referenceType: 'grant',
      referenceId: 'grant_import',
      createdAt: account.createdAt,
    };

    try {
      await migratePostgres({ pool: pool!, schema: importSchema });
      const sqlite = new DatabaseSync(sqlitePath);
      sqlite.exec(`
        CREATE TABLE resvary_schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
        INSERT INTO resvary_schema_migrations(version, applied_at) VALUES (2, 1);
        CREATE TABLE resvary_credit_accounts(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE resvary_ledger_entries(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      `);
      sqlite
        .prepare('INSERT INTO resvary_credit_accounts(id, payload) VALUES (?, ?)')
        .run(account.id, serializeReceiptStoreValue(account));
      sqlite
        .prepare('INSERT INTO resvary_ledger_entries(id, payload) VALUES (?, ?)')
        .run(ledgerEntry.id, serializeReceiptStoreValue(ledgerEntry));
      sqlite.close();

      const dryRun = await importSqliteDatabase({
        pool: pool!,
        schema: importSchema,
        sqlitePath,
        dryRun: true,
      });
      expect(dryRun).toMatchObject({ committed: false, contentMismatches: [] });
      expect(
        (
          await pool!.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM "${importSchema}".resvary_credit_accounts`,
          )
        ).rows[0]?.count,
      ).toBe(0);

      const corrupted = new DatabaseSync(sqlitePath);
      corrupted
        .prepare('UPDATE resvary_ledger_entries SET payload = ? WHERE id = ?')
        .run(serializeReceiptStoreValue({ ...ledgerEntry, deltaUnits: 'invalid' }), ledgerEntry.id);
      corrupted.close();
      await expect(
        importSqliteDatabase({ pool: pool!, schema: importSchema, sqlitePath }),
      ).rejects.toThrow();
      expect(
        (
          await pool!.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM "${importSchema}".resvary_credit_accounts`,
          )
        ).rows[0]?.count,
      ).toBe(0);

      const repaired = new DatabaseSync(sqlitePath);
      repaired
        .prepare('UPDATE resvary_ledger_entries SET payload = ? WHERE id = ?')
        .run(serializeReceiptStoreValue(ledgerEntry), ledgerEntry.id);
      repaired.close();
      const imported = await importSqliteDatabase({
        pool: pool!,
        schema: importSchema,
        sqlitePath,
      });
      expect(imported).toMatchObject({ committed: true, contentMismatches: [] });
      await expect(
        verifySqliteImport({ pool: pool!, schema: importSchema, sqlitePath }),
      ).resolves.toMatchObject({ contentMismatches: [], balanceMismatches: [] });
    } finally {
      await pool!.query(`DROP SCHEMA IF EXISTS "${importSchema}" CASCADE`);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
