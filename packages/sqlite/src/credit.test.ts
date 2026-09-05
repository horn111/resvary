import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CreditLedger, InsufficientCreditsError, type CreditAccount } from '@resvary/sdk/credits';
import { createSqliteCreditStore } from './credit.js';

describe('SqliteCreditStore', () => {
  const posixIt = process.platform === 'win32' ? it.skip : it;

  posixIt('creates new database resources with owner-only permissions', () => {
    const root = mkdtempSync(join(tmpdir(), 'resvary-credits-permissions-'));
    const directory = join(root, 'private');
    const path = join(directory, 'resvary.sqlite');
    const store = createSqliteCreditStore({ path });

    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    for (const suffix of ['-wal', '-shm']) {
      const companion = `${path}${suffix}`;
      if (existsSync(companion)) expect(statSync(companion).mode & 0o777).toBe(0o600);
    }
    store.close();
  });

  it('persists balances, reservations, usage receipts, ledger, outbox, and idempotency across restarts', async () => {
    const path = tempDatabasePath();
    const firstStore = createSqliteCreditStore({ path });
    const first = new CreditLedger({ projectId: 'project_ai', store: firstStore });
    const meter = await first.registerMeter({
      key: 'tokens',
      dimensions: ['tokens'],
      idempotencyKey: 'meter-1',
    });
    const price = await first.createPriceVersion({
      meterKey: meter.key,
      rates: [{ dimension: 'tokens', unitSize: '1000', amount: '0.01' }],
      idempotencyKey: 'price-1',
    });
    await first.grantCredits({ customerId: 'cus_1', amount: '2', idempotencyKey: 'grant-1' });
    const reservation = await first.reserveCredits({
      customerId: 'cus_1',
      priceId: price.id,
      estimatedUsage: { tokens: '1000' },
      idempotencyKey: 'reserve-1',
    });
    const committed = await first.commitUsage({
      reservationId: reservation.id,
      usageEventId: 'provider-1',
      actualUsage: { tokens: '400' },
      idempotencyKey: 'commit-1',
    });
    firstStore.close();

    const secondStore = createSqliteCreditStore({ path });
    const second = new CreditLedger({ projectId: 'project_ai', store: secondStore });
    expect(await second.getBalance('cus_1')).toMatchObject({
      postedAmount: '1.996',
      reservedAmount: '0',
    });
    expect((await second.getUsageReceipt(committed.receipt.id))?.usageEventId).toBe('provider-1');
    expect(await second.listLedgerEntries('cus_1')).toHaveLength(4);
    expect((await second.listOutboxEvents()).map((event) => event.type)).toEqual([
      'credit.granted',
      'credit.reserved',
      'usage.charged',
    ]);
    const replay = await second.grantCredits({
      customerId: 'cus_1',
      amount: '2',
      idempotencyKey: 'grant-1',
    });
    expect(replay.account.postedAmount).toBe('2');
    expect((await second.getBalance('cus_1')).postedAmount).toBe('1.996');
    secondStore.close();
  });

  it('round-trips advanced price components and receipt breakdowns without a schema change', async () => {
    const path = tempDatabasePath();
    const firstStore = createSqliteCreditStore({ path });
    const first = new CreditLedger({ projectId: 'advanced_sqlite', store: firstStore });
    const meter = await first.registerMeter({
      key: 'multimodal',
      dimensions: ['tokens', 'images'],
      idempotencyKey: 'advanced-meter',
    });
    const price = await first.createPriceVersion({
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
      idempotencyKey: 'advanced-price',
    });
    await first.grantCredits({
      customerId: 'advanced-customer',
      amount: '5',
      idempotencyKey: 'advanced-grant',
    });
    const reservation = await first.reserveCredits({
      customerId: 'advanced-customer',
      priceId: price.id,
      estimatedUsage: { tokens: '1500', images: '11' },
      idempotencyKey: 'advanced-reserve',
    });
    const committed = await first.commitUsage({
      reservationId: reservation.id,
      usageEventId: 'advanced-usage',
      actualUsage: { tokens: '1001', images: '10' },
      idempotencyKey: 'advanced-commit',
    });
    firstStore.close();

    const secondStore = createSqliteCreditStore({ path });
    const second = new CreditLedger({ projectId: 'advanced_sqlite', store: secondStore });
    await expect(secondStore.getPriceVersion(price.id)).resolves.toEqual(price);
    await expect(second.getUsageReceipt(committed.receipt.id)).resolves.toEqual(committed.receipt);
    expect(committed.receipt.lineItems).toMatchObject([
      { pricingModel: 'graduated', tierIndex: 0, amountUnits: '1000' },
      { pricingModel: 'graduated', tierIndex: 1, amountUnits: '1' },
      { pricingModel: 'package', packageCount: '1', amountUnits: '1000000' },
    ]);
    secondStore.close();

    const database = new DatabaseSync(path);
    expect(
      (
        database.prepare('SELECT MAX(version) AS version FROM resvary_schema_migrations').get() as {
          version: number;
        }
      ).version,
    ).toBe(6);
    database.close();
  });

  it('migrates v1 funding records to the v2 rail and settlement model', async () => {
    const path = tempDatabasePath();
    const database = new DatabaseSync(path);
    const txHash = `0x${'ab'.repeat(32)}`;
    const account = {
      id: 'account_v1',
      projectId: 'project_v1',
      customerId: 'customer_v1',
      currency: 'USD',
      postedUnits: '2000000',
      reservedUnits: '0',
      availableUnits: '2000000',
      postedAmount: '2',
      reservedAmount: '0',
      availableAmount: '2',
      createdAt: 100,
      updatedAt: 200,
    };
    const intent = {
      id: 'fund_v1',
      projectId: 'project_v1',
      customerId: 'customer_v1',
      accountId: 'account_v1',
      status: 'confirmed',
      requestedAmount: '2',
      requestedUnits: '2000000',
      network: 'arc-testnet',
      invoiceId: 'invoice_v1',
      createdAt: 100,
      confirmedAt: 200,
    };
    const transaction = {
      id: 'ftx_v1',
      fundingIntentId: intent.id,
      projectId: intent.projectId,
      customerId: intent.customerId,
      accountId: intent.accountId,
      network: intent.network,
      txHash,
      amount: '2',
      amountUnits: '2000000',
      paymentReceiptId: 'receipt_v1',
      grantId: 'grant_v1',
      payer: '0x2222222222222222222222222222222222222222',
      createdAt: 200,
    };
    database.exec(`
      CREATE TABLE resvary_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      INSERT INTO resvary_schema_migrations(version, applied_at) VALUES (1, 1);
      CREATE TABLE resvary_credit_accounts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(project_id, customer_id)
      );
      CREATE TABLE resvary_funding_intents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE resvary_funding_transactions (
        id TEXT PRIMARY KEY,
        funding_intent_id TEXT NOT NULL,
        network TEXT NOT NULL,
        tx_hash_norm TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(network, tx_hash_norm)
      );
    `);
    database
      .prepare(
        'INSERT INTO resvary_credit_accounts(id, project_id, customer_id, updated_at, payload) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        account.id,
        account.projectId,
        account.customerId,
        account.updatedAt,
        JSON.stringify(account),
      );
    database
      .prepare(
        'INSERT INTO resvary_funding_intents(id, project_id, customer_id, status, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        intent.id,
        intent.projectId,
        intent.customerId,
        intent.status,
        intent.createdAt,
        JSON.stringify(intent),
      );
    database
      .prepare(
        'INSERT INTO resvary_funding_transactions(id, funding_intent_id, network, tx_hash_norm, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        transaction.id,
        transaction.fundingIntentId,
        transaction.network,
        txHash.toLowerCase(),
        transaction.createdAt,
        JSON.stringify(transaction),
      );
    database.close();

    const store = createSqliteCreditStore({ path });
    expect(await store.getFundingIntent(intent.id)).toMatchObject({ rail: 'arc_direct' });
    expect(
      await store.getFundingTransactionByExternalPayment('arc_direct', intent.network, txHash),
    ).toMatchObject({
      externalPaymentId: txHash,
      rail: 'arc_direct',
      settlementStatus: 'settled',
      acceptedAt: transaction.createdAt,
      settledAt: transaction.createdAt,
    });
    store.close();

    const migrated = new DatabaseSync(path);
    expect(
      (
        migrated.prepare('SELECT MAX(version) AS version FROM resvary_schema_migrations').get() as {
          version: number;
        }
      ).version,
    ).toBe(6);
    migrated.close();
  });

  it('migrates v4 accounts and multiple open reservations into one verified legacy lot', async () => {
    const path = tempDatabasePath();
    const originalStore = createSqliteCreditStore({ path });
    const ledger = new CreditLedger({ projectId: 'legacy_project', store: originalStore });
    const meter = await ledger.registerMeter({
      key: 'jobs',
      dimensions: ['jobs'],
      idempotencyKey: 'legacy-meter',
    });
    const price = await ledger.createPriceVersion({
      meterKey: meter.key,
      rates: [{ dimension: 'jobs', unitSize: '1', amount: '1' }],
      idempotencyKey: 'legacy-price',
    });
    await ledger.grantCredits({
      customerId: 'legacy-customer',
      amount: '10',
      idempotencyKey: 'legacy-grant',
    });
    const first = await ledger.reserveCredits({
      customerId: 'legacy-customer',
      priceId: price.id,
      estimatedUsage: { jobs: '2' },
      idempotencyKey: 'legacy-reserve-a',
    });
    const second = await ledger.reserveCredits({
      customerId: 'legacy-customer',
      priceId: price.id,
      estimatedUsage: { jobs: '3' },
      idempotencyKey: 'legacy-reserve-b',
    });
    originalStore.close();

    const v4 = new DatabaseSync(path);
    v4.exec(`
      DROP TABLE resvary_grant_policy_applications;
      DROP TABLE resvary_credit_lot_allocations;
      DROP TABLE resvary_credit_lots;
      DROP TABLE resvary_grant_policies;
      DELETE FROM resvary_schema_migrations WHERE version >= 5;
    `);
    v4.close();

    const migratedStore = createSqliteCreditStore({ path });
    const migratedLedger = new CreditLedger({ projectId: 'legacy_project', store: migratedStore });
    const lots = await migratedLedger.listCreditLots('legacy-customer');
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({
      kind: 'legacy',
      originalAmount: '10',
      availableAmount: '5',
      reservedAmount: '5',
    });
    expect(await migratedStore.listCreditLotAllocations(first.id)).toMatchObject([
      { reservedAmount: '2', lotId: lots[0]?.id },
    ]);
    expect(await migratedStore.listCreditLotAllocations(second.id)).toMatchObject([
      { reservedAmount: '3', lotId: lots[0]?.id },
    ]);
    migratedStore.close();
  });

  it('rolls v5 migration back when open reservations do not match the account snapshot', async () => {
    const path = tempDatabasePath();
    const store = createSqliteCreditStore({ path });
    const ledger = new CreditLedger({ projectId: 'invalid_backfill', store });
    const meter = await ledger.registerMeter({
      key: 'jobs',
      dimensions: ['jobs'],
      idempotencyKey: 'invalid-meter',
    });
    const price = await ledger.createPriceVersion({
      meterKey: meter.key,
      rates: [{ dimension: 'jobs', unitSize: '1', amount: '1' }],
      idempotencyKey: 'invalid-price',
    });
    await ledger.grantCredits({
      customerId: 'invalid-customer',
      amount: '5',
      idempotencyKey: 'invalid-grant',
    });
    const reservation = await ledger.reserveCredits({
      customerId: 'invalid-customer',
      priceId: price.id,
      estimatedUsage: { jobs: '1' },
      idempotencyKey: 'invalid-reserve',
    });
    store.close();

    const v4 = new DatabaseSync(path);
    v4.exec(`
      DROP TABLE resvary_grant_policy_applications;
      DROP TABLE resvary_credit_lot_allocations;
      DROP TABLE resvary_credit_lots;
      DROP TABLE resvary_grant_policies;
      DELETE FROM resvary_schema_migrations WHERE version >= 5;
    `);
    v4.prepare('UPDATE resvary_credit_reservations SET status = ? WHERE id = ?').run(
      'released',
      reservation.id,
    );
    v4.close();

    expect(() => createSqliteCreditStore({ path })).toThrow(
      'open reservations do not match account',
    );
    const unchanged = new DatabaseSync(path);
    expect(
      (
        unchanged
          .prepare('SELECT MAX(version) AS version FROM resvary_schema_migrations')
          .get() as {
          version: number;
        }
      ).version,
    ).toBe(4);
    expect(
      (
        unchanged
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'resvary_credit_lots'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
    unchanged.close();
  });

  it('stops the v6 admin backfill on a project mismatch', async () => {
    const path = tempDatabasePath();
    const store = createSqliteCreditStore({ path });
    const ledger = new CreditLedger({ projectId: 'v5_project', store });
    await ledger.grantCredits({
      customerId: 'v5_customer',
      amount: '5',
      idempotencyKey: 'v5-grant',
    });
    store.close();

    const v5 = new DatabaseSync(path);
    const row = v5.prepare('SELECT id, payload FROM resvary_credit_grants LIMIT 1').get() as {
      id: string;
      payload: string;
    };
    const grant = JSON.parse(row.payload) as { projectId: string };
    grant.projectId = 'wrong_project';
    v5.prepare('UPDATE resvary_credit_grants SET payload = ? WHERE id = ?').run(
      JSON.stringify(grant),
      row.id,
    );
    v5.exec('DELETE FROM resvary_schema_migrations WHERE version >= 6');
    v5.close();

    expect(() => createSqliteCreditStore({ path })).toThrow('project/customer mismatch');
    const unchanged = new DatabaseSync(path);
    expect(
      (
        unchanged
          .prepare('SELECT MAX(version) AS version FROM resvary_schema_migrations')
          .get() as {
          version: number;
        }
      ).version,
    ).toBe(5);
    unchanged.close();
  });

  it('persists grant policies, applications, and expiring lots across restarts', async () => {
    const path = tempDatabasePath();
    let now = 1_000;
    const firstStore = createSqliteCreditStore({ path });
    const first = new CreditLedger({
      projectId: 'policy_project',
      store: firstStore,
      now: () => now,
    });
    const policy = await first.createGrantPolicy({
      type: 'promotion',
      key: 'restart-promo',
      amount: '2',
      expiresInMs: 100,
      idempotencyKey: 'restart-policy',
    });
    const claim = await first.claimPromotion({
      policyId: policy.id,
      customerId: 'restart-customer',
      idempotencyKey: 'restart-claim',
    });
    firstStore.close();

    now = 1_101;
    const secondStore = createSqliteCreditStore({ path });
    const second = new CreditLedger({
      projectId: 'policy_project',
      store: secondStore,
      now: () => now,
    });
    expect(await second.getGrantPolicy(policy.id)).toEqual(policy);
    expect(await second.listGrantPolicyApplications('restart-customer')).toEqual([
      claim.application,
    ]);
    expect(await second.getBalance('restart-customer')).toMatchObject({ postedAmount: '0' });
    expect(await second.listCreditLots('restart-customer')).toMatchObject([
      { kind: 'promotion', expiredAmount: '2', availableAmount: '0' },
    ]);
    secondStore.close();
  });

  it('rolls a failed transaction back completely', async () => {
    const store = createSqliteCreditStore({ path: tempDatabasePath() });
    const account: CreditAccount = {
      id: 'acct_rollback',
      projectId: 'project_ai',
      customerId: 'cus_rollback',
      currency: 'USD',
      postedUnits: '1000000',
      reservedUnits: '0',
      availableUnits: '1000000',
      postedAmount: '1',
      reservedAmount: '0',
      availableAmount: '1',
      createdAt: 1,
      updatedAt: 1,
    };
    await expect(
      store.transaction(async (tx) => {
        await tx.saveAccount(account);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await store.getAccount(account.id)).toBeUndefined();
    store.close();
  });

  it('serializes parallel reservations against the same account', async () => {
    const store = createSqliteCreditStore({ path: tempDatabasePath() });
    const ledger = new CreditLedger({ projectId: 'project_ai', store });
    const meter = await ledger.registerMeter({
      key: 'jobs',
      dimensions: ['jobs'],
      idempotencyKey: 'meter-1',
    });
    const price = await ledger.createPriceVersion({
      meterKey: meter.key,
      rates: [{ dimension: 'jobs', unitSize: '1', amount: '1' }],
      idempotencyKey: 'price-1',
    });
    await ledger.grantCredits({ customerId: 'cus_1', amount: '1', idempotencyKey: 'grant-1' });
    const results = await Promise.allSettled(
      ['a', 'b'].map((key) =>
        ledger.reserveCredits({
          customerId: 'cus_1',
          priceId: price.id,
          estimatedUsage: { jobs: '1' },
          idempotencyKey: `reserve-${key}`,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect((await ledger.getBalance('cus_1')).availableAmount).toBe('0');
    store.close();
  });

  it('rejects a transaction hash already credited through another funding rail', async () => {
    const store = createSqliteCreditStore({ path: tempDatabasePath() });
    const ledger = new CreditLedger({ projectId: 'project_funding', store });
    const externalPaymentId = `0x${'aa'.repeat(32)}`;

    const direct = await ledger.createFundingIntent({
      customerId: 'cus_direct',
      amount: '1',
      rail: 'arc_direct',
      network: 'arc-testnet',
      invoiceId: 'invoice_direct',
      idempotencyKey: 'intent_direct',
    });
    const gateway = await ledger.createFundingIntent({
      customerId: 'cus_gateway',
      amount: '1',
      rail: 'circle_gateway_nanopayment',
      network: 'arc-testnet',
      invoiceId: 'invoice_gateway',
      idempotencyKey: 'intent_gateway',
    });

    await ledger.confirmFunding({
      fundingIntentId: direct.id,
      rail: 'arc_direct',
      network: 'arc-testnet',
      externalPaymentId,
      txHash: externalPaymentId as `0x${string}`,
      amount: '1',
      paymentReceiptId: 'receipt_direct',
      idempotencyKey: 'confirm_direct',
    });
    await expect(
      ledger.confirmFunding({
        fundingIntentId: gateway.id,
        rail: 'circle_gateway_nanopayment',
        network: 'arc-testnet',
        externalPaymentId,
        txHash: externalPaymentId as `0x${string}`,
        amount: '1',
        paymentReceiptId: 'receipt_gateway',
        requireExactAmount: true,
        idempotencyKey: 'confirm_gateway',
      }),
    ).rejects.toThrow('already assigned');

    expect(await ledger.listFundingTransactions()).toHaveLength(1);

    const duplicate = await ledger.createFundingIntent({
      customerId: 'cus_duplicate',
      amount: '1',
      rail: 'circle_gateway_nanopayment',
      network: 'arc-testnet',
      invoiceId: 'invoice_duplicate',
      idempotencyKey: 'intent_duplicate',
    });
    await expect(
      ledger.confirmFunding({
        fundingIntentId: duplicate.id,
        rail: 'circle_gateway_nanopayment',
        network: 'arc-testnet',
        externalPaymentId: `gateway:${externalPaymentId}`,
        txHash: externalPaymentId as `0x${string}`,
        amount: '1',
        paymentReceiptId: 'receipt_duplicate',
        requireExactAmount: true,
        idempotencyKey: 'confirm_duplicate',
      }),
    ).rejects.toThrow('already assigned');

    store.close();
  });

  it('preserves funding intent ownership when another project reuses its id', async () => {
    const store = createSqliteCreditStore({ path: tempDatabasePath() });
    const victim = new CreditLedger({ projectId: 'sqlite_victim', store });
    const attacker = new CreditLedger({ projectId: 'sqlite_attacker', store });
    const intent = await victim.createFundingIntent({
      id: 'fund_sqlite_shared',
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
      projectId: 'sqlite_victim',
      requestedAmount: '3',
    });
    await expect(attacker.getFundingIntent(intent.id)).resolves.toBeUndefined();
    store.close();
  });
});

function tempDatabasePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'resvary-credits-')), 'resvary.sqlite');
}
