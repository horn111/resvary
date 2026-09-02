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
import { applyV1, applyV2, migratePostgres } from './migrations.js';
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
    expect(status).toMatchObject({ currentVersion: 3, latestVersion: 3, pendingVersions: [] });
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
      expect(status).toMatchObject({ currentVersion: 3, latestVersion: 3, pendingVersions: [] });
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

  it('upgrades v2 accounts and open reservations into verified legacy lots', async () => {
    const upgradeSchema = `resvary_upgrade_v2_${randomUUID().replaceAll('-', '')}`;
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
      await applyV2(client, upgradeSchema);
      const account = {
        id: 'acct_v2_backfill',
        projectId: 'project_v2_backfill',
        customerId: 'customer_v2_backfill',
        currency: 'USD',
        postedUnits: '10000000',
        reservedUnits: '5000000',
        availableUnits: '5000000',
        postedAmount: '10',
        reservedAmount: '5',
        availableAmount: '5',
        createdAt: 100,
        updatedAt: 200,
      };
      await client.query(
        `INSERT INTO "${upgradeSchema}".resvary_credit_accounts
          (id, project_id, customer_id, currency, posted_units, reserved_units, updated_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          account.id,
          account.projectId,
          account.customerId,
          account.currency,
          account.postedUnits,
          account.reservedUnits,
          account.updatedAt,
          serializeReceiptStoreValue(account),
        ],
      );
      for (const [id, units] of [
        ['rsv_v2_a', '2000000'],
        ['rsv_v2_b', '3000000'],
      ] as const) {
        const reservation = {
          id,
          accountId: account.id,
          projectId: account.projectId,
          customerId: account.customerId,
          priceId: 'legacy_price',
          status: 'open',
          estimatedUsage: {},
          reservedAmount: units === '2000000' ? '2' : '3',
          reservedUnits: units,
          createdAt: 150,
          expiresAt: 10_000,
        };
        await client.query(
          `INSERT INTO "${upgradeSchema}".resvary_credit_reservations
            (id, account_id, project_id, customer_id, status, reserved_units, expires_at, created_at, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            reservation.id,
            reservation.accountId,
            reservation.projectId,
            reservation.customerId,
            reservation.status,
            reservation.reservedUnits,
            reservation.expiresAt,
            reservation.createdAt,
            serializeReceiptStoreValue(reservation),
          ],
        );
      }
      const status = await migratePostgres({ pool: pool!, schema: upgradeSchema });
      expect(status).toMatchObject({ currentVersion: 3, latestVersion: 3 });
      const store = createPostgresCreditStore({ pool: pool!, schema: upgradeSchema });
      await expect(store.listCreditLots({ customerId: account.customerId })).resolves.toMatchObject(
        [{ kind: 'legacy', originalAmount: '10', availableAmount: '5', reservedAmount: '5' }],
      );
      await expect(store.listCreditLotAllocations()).resolves.toHaveLength(2);
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

  it('round-trips advanced prices and receipt breakdowns on schema v3', async () => {
    const store = createPostgresCreditStore({ pool: pool!, schema });
    const ledger = new CreditLedger({ projectId: 'postgres_advanced', store });
    const meter = await ledger.registerMeter({
      key: 'advanced-pricing',
      dimensions: ['tokens', 'images'],
      idempotencyKey: 'postgres-advanced-meter',
    });
    const price = await ledger.createPriceVersion({
      meterKey: meter.key,
      components: [
        {
          model: 'graduated',
          dimension: 'tokens',
          tiers: [
            { upTo: '1000', unitSize: '1000', amount: '0.001' },
            { unitSize: '1000', amount: '0.0005' },
          ],
        },
        { model: 'package', dimension: 'images', packageSize: '10', amount: '1' },
      ],
      idempotencyKey: 'postgres-advanced-price',
    });
    await ledger.grantCredits({
      customerId: 'postgres-advanced-customer',
      amount: '5',
      idempotencyKey: 'postgres-advanced-grant',
    });
    const reservation = await ledger.reserveCredits({
      customerId: 'postgres-advanced-customer',
      priceId: price.id,
      estimatedUsage: { tokens: '1500', images: '11' },
      idempotencyKey: 'postgres-advanced-reserve',
    });
    const committed = await ledger.commitUsage({
      reservationId: reservation.id,
      usageEventId: 'postgres-advanced-usage',
      actualUsage: { tokens: '1001', images: '10' },
      idempotencyKey: 'postgres-advanced-commit',
    });

    const reloaded = createPostgresCreditStore({ pool: pool!, schema });
    await expect(reloaded.getPriceVersion(price.id)).resolves.toEqual(price);
    await expect(reloaded.getUsageReceipt(committed.receipt.id)).resolves.toEqual(
      committed.receipt,
    );
    expect(committed.receipt.lineItems).toMatchObject([
      { pricingModel: 'graduated', tierIndex: 0, amountUnits: '1000' },
      { pricingModel: 'graduated', tierIndex: 1, amountUnits: '1' },
      { pricingModel: 'package', packageCount: '1', amountUnits: '1000000' },
    ]);
  });

  it('serializes allowance applications across independent store instances', async () => {
    const firstStore = createPostgresCreditStore({ pool: pool!, schema });
    const secondStore = createPostgresCreditStore({ pool: pool!, schema });
    const first = new CreditLedger({ projectId: 'allowance_project', store: firstStore });
    const second = new CreditLedger({ projectId: 'allowance_project', store: secondStore });
    const policy = await first.createGrantPolicy({
      type: 'allowance',
      key: 'monthly-concurrent',
      cadence: 'month',
      amount: '5',
      idempotencyKey: 'monthly-concurrent-policy',
    });
    const results = await Promise.all([
      first.applyAllowance({
        policyId: policy.id,
        customerId: 'allowance-customer',
        idempotencyKey: 'allowance-first',
      }),
      second.applyAllowance({
        policyId: policy.id,
        customerId: 'allowance-customer',
        idempotencyKey: 'allowance-second',
      }),
    ]);
    expect(new Set(results.map((result) => result.application.id)).size).toBe(1);
    expect((await first.getBalance('allowance-customer')).postedAmount).toBe('5');
    expect(await first.listGrantPolicyApplications('allowance-customer')).toHaveLength(1);
  });

  it('preserves funding intent ownership across projects', async () => {
    const store = createPostgresCreditStore({ pool: pool!, schema });
    const victim = new CreditLedger({ projectId: 'postgres_victim', store });
    const attacker = new CreditLedger({ projectId: 'postgres_attacker', store });
    const intent = await victim.createFundingIntent({
      id: 'fund_postgres_shared',
      customerId: 'victim_customer',
      amount: '3',
      network: 'arc-testnet',
      invoiceId: 'victim_invoice',
      idempotencyKey: 'victim_create',
    });

    await expect(
      attacker.createFundingIntent({
        id: intent.id,
        customerId: 'attacker_customer',
        amount: '1',
        network: 'arc-testnet',
        invoiceId: 'attacker_invoice',
        idempotencyKey: 'attacker_create',
      }),
    ).rejects.toThrow('Funding intent id already exists');
    await expect(victim.getFundingIntent(intent.id)).resolves.toMatchObject({
      projectId: 'postgres_victim',
      requestedAmount: '3',
    });
    await expect(attacker.getFundingIntent(intent.id)).resolves.toBeUndefined();
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

  it('dry-runs, rolls back corruption, imports, and verifies a SQLite v5 fixture', async () => {
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
    const legacyLot = {
      id: `lot_legacy_${account.id}`,
      accountId: account.id,
      projectId: account.projectId,
      customerId: account.customerId,
      kind: 'legacy',
      originalAmount: '1',
      originalUnits: '1000000',
      availableAmount: '1',
      availableUnits: '1000000',
      reservedAmount: '0',
      reservedUnits: '0',
      consumedAmount: '0',
      consumedUnits: '0',
      expiredAmount: '0',
      expiredUnits: '0',
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
    const meter = {
      id: 'meter_import',
      projectId: account.projectId,
      key: 'advanced_import',
      name: 'Advanced import',
      dimensions: ['tokens'],
      createdAt: account.createdAt,
    };
    const price = {
      id: 'price_import',
      projectId: account.projectId,
      meterId: meter.id,
      meterKey: meter.key,
      version: 1,
      currency: 'USD',
      rates: [],
      components: [
        {
          model: 'graduated',
          dimension: 'tokens',
          tiers: [
            {
              upTo: '1000',
              unitSize: '1000',
              amount: '0.001',
              amountUnits: '1000',
            },
            { unitSize: '1000', amount: '0.0005', amountUnits: '500' },
          ],
        },
      ],
      createdAt: account.createdAt,
    };

    try {
      await migratePostgres({ pool: pool!, schema: importSchema });
      const sqlite = new DatabaseSync(sqlitePath);
      sqlite.exec(`
        CREATE TABLE resvary_schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
        INSERT INTO resvary_schema_migrations(version, applied_at) VALUES (1, 1), (2, 1), (3, 1), (4, 1), (5, 1);
        CREATE TABLE resvary_credit_accounts(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE resvary_credit_lots(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE resvary_meters(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE resvary_price_versions(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE resvary_ledger_entries(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      `);
      sqlite
        .prepare('INSERT INTO resvary_credit_accounts(id, payload) VALUES (?, ?)')
        .run(account.id, serializeReceiptStoreValue(account));
      sqlite
        .prepare('INSERT INTO resvary_credit_lots(id, payload) VALUES (?, ?)')
        .run(legacyLot.id, serializeReceiptStoreValue(legacyLot));
      sqlite
        .prepare('INSERT INTO resvary_meters(id, payload) VALUES (?, ?)')
        .run(meter.id, serializeReceiptStoreValue(meter));
      sqlite
        .prepare('INSERT INTO resvary_price_versions(id, payload) VALUES (?, ?)')
        .run(price.id, serializeReceiptStoreValue(price));
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
      ).resolves.toMatchObject({
        contentMismatches: [],
        balanceMismatches: [],
        allocationMismatches: [],
      });
      await expect(
        createPostgresCreditStore({ pool: pool!, schema: importSchema }).getPriceVersion(price.id),
      ).resolves.toEqual(price);
    } finally {
      await pool!.query(`DROP SCHEMA IF EXISTS "${importSchema}" CASCADE`);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
