import { DatabaseSync, type DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { creditUnitsToString, parseCreditUnits } from '@resvary/sdk/credits';
import type {
  CreditAccount,
  CreditBalanceFilter,
  CreditGrant,
  CreditGrantPolicy,
  CreditLot,
  CreditLotAllocation,
  CreditLotFilter,
  CreditOutboxEvent,
  CreditReservation,
  CreditReservationFilter,
  CreditStoreReader,
  CreditStoreTransaction,
  CreditPolicyStore,
  CreditPolicyStoreReader,
  CreditPolicyStoreTransaction,
  IdempotencyRecord,
  FundingIntent,
  FundingTransaction,
  GrantPolicyApplication,
  GrantPolicyApplicationFilter,
  LedgerEntry,
  MeterDefinition,
  OutboxEventFilter,
  OutboxDeliveryStore,
  ClaimOutboxEventsInput,
  FailOutboxEventInput,
  PriceVersion,
  UsageEvent,
  UsageReceipt,
} from '@resvary/sdk/credits';
import { parseReceiptStoreValue, serializeReceiptStoreValue } from '@resvary/sdk/receipts';
import { hardenSqliteDatabaseFiles, prepareSqliteDatabasePath } from './filesystem.js';

export interface SqliteCreditStoreConfig {
  path: string;
  createDirectory?: boolean;
}

type PayloadRow = { payload: string };

export class SqliteCreditStore implements CreditPolicyStore, OutboxDeliveryStore {
  private readonly db: DatabaseSyncType;
  private transactionTail: Promise<void> = Promise.resolve();

  constructor(config: SqliteCreditStoreConfig) {
    prepareSqliteDatabasePath(config.path, config.createDirectory !== false);
    this.db = new DatabaseSync(config.path);
    this.migrate();
    hardenSqliteDatabaseFiles(config.path);
  }

  async transaction<T>(
    handler: (transaction: CreditPolicyStoreTransaction) => Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.transactionTail;
    this.transactionTail = previous.then(() => current);
    await previous;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await handler(new SqliteCreditTransaction(this.db));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      release();
    }
  }

  getAccount(id: string) {
    return reader(this.db).getAccount(id);
  }
  getAccountByCustomer(projectId: string, customerId: string) {
    return reader(this.db).getAccountByCustomer(projectId, customerId);
  }
  listAccounts(filter?: CreditBalanceFilter) {
    return reader(this.db).listAccounts(filter);
  }
  getGrant(id: string) {
    return reader(this.db).getGrant(id);
  }
  listGrants(accountId?: string) {
    return reader(this.db).listGrants(accountId);
  }
  getMeter(id: string) {
    return reader(this.db).getMeter(id);
  }
  getMeterByKey(projectId: string, key: string) {
    return reader(this.db).getMeterByKey(projectId, key);
  }
  getPriceVersion(id: string) {
    return reader(this.db).getPriceVersion(id);
  }
  listPriceVersions(meterId?: string) {
    return reader(this.db).listPriceVersions(meterId);
  }
  getReservation(id: string) {
    return reader(this.db).getReservation(id);
  }
  listReservations(filter?: CreditReservationFilter) {
    return reader(this.db).listReservations(filter);
  }
  getUsageEvent(id: string) {
    return reader(this.db).getUsageEvent(id);
  }
  getUsageReceipt(id: string) {
    return reader(this.db).getUsageReceipt(id);
  }
  listUsageReceipts(accountId?: string) {
    return reader(this.db).listUsageReceipts(accountId);
  }
  listLedgerEntries(accountId?: string) {
    return reader(this.db).listLedgerEntries(accountId);
  }
  getOutboxEvent(id: string) {
    return reader(this.db).getOutboxEvent(id);
  }
  listOutboxEvents(filter?: OutboxEventFilter) {
    return reader(this.db).listOutboxEvents(filter);
  }
  getIdempotencyRecord(scope: string, key: string) {
    return reader(this.db).getIdempotencyRecord(scope, key);
  }
  getFundingIntent(id: string) {
    return reader(this.db).getFundingIntent(id);
  }
  listFundingIntents(projectId?: string) {
    return reader(this.db).listFundingIntents(projectId);
  }
  getFundingTransaction(id: string) {
    return reader(this.db).getFundingTransaction(id);
  }
  getFundingTransactionByExternalPayment(
    rail: FundingTransaction['rail'],
    network: string,
    externalPaymentId: string,
  ) {
    return reader(this.db).getFundingTransactionByExternalPayment(rail, network, externalPaymentId);
  }
  getFundingTransactionByTxHash(network: string, txHash: `0x${string}`) {
    return reader(this.db).getFundingTransactionByTxHash(network, txHash);
  }
  listFundingTransactions(fundingIntentId?: string) {
    return reader(this.db).listFundingTransactions(fundingIntentId);
  }
  getGrantPolicy(id: string) {
    return reader(this.db).getGrantPolicy(id);
  }
  listGrantPolicies(projectId?: string) {
    return reader(this.db).listGrantPolicies(projectId);
  }
  getCreditLot(id: string) {
    return reader(this.db).getCreditLot(id);
  }
  listCreditLots(filter?: CreditLotFilter) {
    return reader(this.db).listCreditLots(filter);
  }
  listCreditLotAllocations(reservationId?: string) {
    return reader(this.db).listCreditLotAllocations(reservationId);
  }
  getGrantPolicyApplication(id: string) {
    return reader(this.db).getGrantPolicyApplication(id);
  }
  getGrantPolicyApplicationByIdentity(policyId: string, accountId: string, periodKey: string) {
    return reader(this.db).getGrantPolicyApplicationByIdentity(policyId, accountId, periodKey);
  }
  listGrantPolicyApplications(filter?: GrantPolicyApplicationFilter) {
    return reader(this.db).listGrantPolicyApplications(filter);
  }

  claimOutboxEvents(input: ClaimOutboxEventsInput): Promise<CreditOutboxEvent[]> {
    return this.transaction(async (tx) => {
      const events = (await tx.listOutboxEvents({ projectId: input.projectId }))
        .filter(
          (event) =>
            (event.status === 'pending' && event.nextAttemptAt <= input.now) ||
            (event.status === 'processing' && (event.leaseExpiresAt ?? 0) <= input.now),
        )
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.createdAt - b.createdAt)
        .slice(0, input.limit);
      const claimed: CreditOutboxEvent[] = [];
      for (const event of events) {
        const value: CreditOutboxEvent = {
          ...event,
          status: 'processing',
          attemptCount: event.attemptCount + 1,
          leaseOwner: input.workerId,
          leaseExpiresAt: input.now + input.leaseMs,
          lastAttemptAt: input.now,
        };
        await tx.saveOutboxEvent(value);
        claimed.push(value);
      }
      return claimed;
    });
  }

  async completeOutboxEvent(
    eventId: string,
    workerId: string,
    deliveredAt: number,
    attemptCount?: number,
  ): Promise<void> {
    await this.transaction(async (tx) => {
      const event = await requireClaimedEvent(tx, eventId, workerId, attemptCount);
      await tx.saveOutboxEvent({
        ...event,
        status: 'delivered',
        deliveredAt,
        nextAttemptAt: deliveredAt,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: undefined,
      });
    });
  }

  async failOutboxEvent(input: FailOutboxEventInput): Promise<void> {
    await this.transaction(async (tx) => {
      const event = await requireClaimedEvent(
        tx,
        input.eventId,
        input.workerId,
        input.attemptCount,
      );
      await tx.saveOutboxEvent({
        ...event,
        status: input.deadLetter ? 'dead_letter' : 'pending',
        nextAttemptAt: input.nextAttemptAt,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: input.error,
      });
    });
  }

  listDeadLetterEvents(projectId?: string): Promise<CreditOutboxEvent[]> {
    return this.listOutboxEvents({ projectId, status: 'dead_letter' });
  }

  async requeueOutboxEvent(eventId: string, now: number): Promise<void> {
    await this.transaction(async (tx) => {
      const event = await tx.getOutboxEvent(eventId);
      if (!event) throw new Error(`Outbox event not found: ${eventId}`);
      if (event.status !== 'dead_letter') {
        throw new Error(`Outbox event is not dead-lettered: ${eventId}`);
      }
      await tx.saveOutboxEvent({
        ...event,
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: now,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastError: undefined,
      });
    });
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS resvary_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resvary_credit_accounts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(project_id, customer_id)
      );

      CREATE TABLE IF NOT EXISTS resvary_credit_grants (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS resvary_credit_grants_account ON resvary_credit_grants(account_id);

      CREATE TABLE IF NOT EXISTS resvary_meters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        meter_key TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(project_id, meter_key)
      );

      CREATE TABLE IF NOT EXISTS resvary_price_versions (
        id TEXT PRIMARY KEY,
        meter_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(meter_id, version)
      );

      CREATE TABLE IF NOT EXISTS resvary_credit_reservations (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS resvary_credit_reservations_open
        ON resvary_credit_reservations(project_id, customer_id, status, expires_at);

      CREATE TABLE IF NOT EXISTS resvary_usage_events (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resvary_usage_receipts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        reservation_id TEXT NOT NULL UNIQUE,
        usage_event_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS resvary_usage_receipts_account ON resvary_usage_receipts(account_id, created_at);

      CREATE TABLE IF NOT EXISTS resvary_ledger_entries (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS resvary_ledger_entries_account ON resvary_ledger_entries(account_id, created_at);

      CREATE TABLE IF NOT EXISTS resvary_funding_intents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resvary_funding_transactions (
        id TEXT PRIMARY KEY,
        funding_intent_id TEXT NOT NULL,
        network TEXT NOT NULL,
        tx_hash_norm TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(network, tx_hash_norm)
      );

      CREATE TABLE IF NOT EXISTS resvary_idempotency_keys (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY(scope, key)
      );

      CREATE TABLE IF NOT EXISTS resvary_outbox_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS resvary_outbox_events_pending
        ON resvary_outbox_events(project_id, status, created_at);

      INSERT OR IGNORE INTO resvary_schema_migrations(version, applied_at)
        VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
    `);
    this.migrateFundingV2();
    this.migrateOutboxV3();
    this.migrateFundingTransactionHashV4();
    this.migrateCreditLotsV5();
  }

  private migrateFundingV2(): void {
    const row = this.db
      .prepare('SELECT MAX(version) AS version FROM resvary_schema_migrations')
      .get() as { version?: number | null } | undefined;
    if ((row?.version ?? 0) >= 2) return;

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.exec(`
        ALTER TABLE resvary_funding_transactions
          ADD COLUMN rail TEXT NOT NULL DEFAULT 'arc_direct';
        ALTER TABLE resvary_funding_transactions
          ADD COLUMN external_payment_id_norm TEXT;
        UPDATE resvary_funding_transactions
          SET external_payment_id_norm = tx_hash_norm
          WHERE external_payment_id_norm IS NULL;

        ALTER TABLE resvary_funding_transactions
          RENAME TO resvary_funding_transactions_v1;
        CREATE TABLE resvary_funding_transactions (
          id TEXT PRIMARY KEY,
          funding_intent_id TEXT NOT NULL,
          rail TEXT NOT NULL,
          network TEXT NOT NULL,
          external_payment_id_norm TEXT NOT NULL,
          tx_hash_norm TEXT,
          created_at INTEGER NOT NULL,
          payload TEXT NOT NULL,
          UNIQUE(rail, network, external_payment_id_norm)
        );
        INSERT INTO resvary_funding_transactions(
          id,
          funding_intent_id,
          rail,
          network,
          external_payment_id_norm,
          tx_hash_norm,
          created_at,
          payload
        )
        SELECT
          id,
          funding_intent_id,
          rail,
          network,
          external_payment_id_norm,
          tx_hash_norm,
          created_at,
          payload
        FROM resvary_funding_transactions_v1;
        DROP TABLE resvary_funding_transactions_v1;
        CREATE INDEX resvary_funding_transactions_tx_hash
          ON resvary_funding_transactions(network, tx_hash_norm);
      `);

      const intents = this.db
        .prepare('SELECT id, payload FROM resvary_funding_intents')
        .all() as Array<{ id: string; payload: string }>;
      for (const intentRow of intents) {
        const intent = parseReceiptStoreValue<FundingIntent>(intentRow.payload);
        this.db
          .prepare('UPDATE resvary_funding_intents SET payload = ? WHERE id = ?')
          .run(
            serializeReceiptStoreValue({ ...intent, rail: intent.rail ?? 'arc_direct' }),
            intentRow.id,
          );
      }

      const transactions = this.db
        .prepare('SELECT id, payload FROM resvary_funding_transactions')
        .all() as Array<{ id: string; payload: string }>;
      for (const transactionRow of transactions) {
        const transaction = parseReceiptStoreValue<FundingTransaction>(transactionRow.payload);
        const externalPaymentId =
          transaction.externalPaymentId ?? transaction.txHash ?? transactionRow.id;
        const migrated: FundingTransaction = {
          ...transaction,
          rail: transaction.rail ?? 'arc_direct',
          externalPaymentId,
          settlementStatus: transaction.settlementStatus ?? 'settled',
          acceptedAt: transaction.acceptedAt ?? transaction.createdAt,
          settledAt: transaction.settledAt ?? transaction.createdAt,
          evidence: transaction.evidence ?? {
            amountUnits: transaction.amountUnits,
            payer: transaction.payer,
          },
        };
        this.db
          .prepare(
            `
          UPDATE resvary_funding_transactions
          SET rail = ?, external_payment_id_norm = ?, payload = ?
          WHERE id = ?
        `,
          )
          .run(
            migrated.rail,
            migrated.externalPaymentId.toLowerCase(),
            serializeReceiptStoreValue(migrated),
            transactionRow.id,
          );
      }

      this.db
        .prepare('INSERT INTO resvary_schema_migrations(version, applied_at) VALUES (2, ?)')
        .run(Date.now());
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  private migrateOutboxV3(): void {
    const row = this.db
      .prepare('SELECT MAX(version) AS version FROM resvary_schema_migrations')
      .get() as { version?: number | null } | undefined;
    if ((row?.version ?? 0) >= 3) return;

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.exec(`
        ALTER TABLE resvary_outbox_events ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE resvary_outbox_events ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE resvary_outbox_events ADD COLUMN lease_owner TEXT;
        ALTER TABLE resvary_outbox_events ADD COLUMN lease_expires_at INTEGER;
        DROP INDEX IF EXISTS resvary_outbox_events_pending;
        CREATE INDEX resvary_outbox_events_due
          ON resvary_outbox_events(project_id, status, next_attempt_at, created_at);
      `);
      const rows = this.db
        .prepare('SELECT id, created_at, payload FROM resvary_outbox_events')
        .all() as Array<{ id: string; created_at: number; payload: string }>;
      for (const item of rows) {
        const event = parseReceiptStoreValue<CreditOutboxEvent>(item.payload);
        const migrated: CreditOutboxEvent = {
          ...event,
          attemptCount: event.attemptCount ?? 0,
          nextAttemptAt: event.nextAttemptAt ?? item.created_at,
        };
        this.db
          .prepare(
            `UPDATE resvary_outbox_events
             SET attempt_count = ?, next_attempt_at = ?, lease_owner = ?, lease_expires_at = ?, payload = ?
             WHERE id = ?`,
          )
          .run(
            migrated.attemptCount,
            migrated.nextAttemptAt,
            migrated.leaseOwner ?? null,
            migrated.leaseExpiresAt ?? null,
            serializeReceiptStoreValue(migrated),
            item.id,
          );
      }
      this.db
        .prepare('INSERT INTO resvary_schema_migrations(version, applied_at) VALUES (3, ?)')
        .run(Date.now());
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  private migrateFundingTransactionHashV4(): void {
    const row = this.db
      .prepare('SELECT MAX(version) AS version FROM resvary_schema_migrations')
      .get() as { version?: number | null } | undefined;
    if ((row?.version ?? 0) >= 4) return;

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const duplicate = this.db
        .prepare(
          `SELECT network, tx_hash_norm, COUNT(*) AS count
           FROM resvary_funding_transactions
           WHERE tx_hash_norm IS NOT NULL
           GROUP BY network, tx_hash_norm
           HAVING COUNT(*) > 1
           LIMIT 1`,
        )
        .get() as { network: string; tx_hash_norm: string; count: number } | undefined;
      if (duplicate) {
        throw new Error(
          `Cannot migrate SQLite funding transaction uniqueness: ${duplicate.count} records use ${duplicate.network}:${duplicate.tx_hash_norm}`,
        );
      }
      this.db.exec(`
        DROP INDEX IF EXISTS resvary_funding_transactions_tx_hash;
        CREATE UNIQUE INDEX resvary_funding_transactions_tx_hash
          ON resvary_funding_transactions(network, tx_hash_norm)
          WHERE tx_hash_norm IS NOT NULL;
      `);
      this.db
        .prepare('INSERT INTO resvary_schema_migrations(version, applied_at) VALUES (4, ?)')
        .run(Date.now());
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  private migrateCreditLotsV5(): void {
    const row = this.db
      .prepare('SELECT MAX(version) AS version FROM resvary_schema_migrations')
      .get() as { version?: number | null } | undefined;
    if ((row?.version ?? 0) >= 5) return;

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.exec(`
        CREATE TABLE resvary_grant_policies (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          policy_key TEXT NOT NULL,
          version INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          payload TEXT NOT NULL,
          UNIQUE(project_id, policy_key, version)
        );
        CREATE INDEX resvary_grant_policies_project
          ON resvary_grant_policies(project_id, created_at);

        CREATE TABLE resvary_credit_lots (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          customer_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          policy_id TEXT,
          expires_at INTEGER,
          created_at INTEGER NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE INDEX resvary_credit_lots_account
          ON resvary_credit_lots(account_id, created_at);
        CREATE INDEX resvary_credit_lots_expiry
          ON resvary_credit_lots(project_id, expires_at)
          WHERE expires_at IS NOT NULL;

        CREATE TABLE resvary_credit_lot_allocations (
          id TEXT PRIMARY KEY,
          reservation_id TEXT NOT NULL,
          lot_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          payload TEXT NOT NULL,
          UNIQUE(reservation_id, lot_id)
        );
        CREATE INDEX resvary_credit_lot_allocations_reservation
          ON resvary_credit_lot_allocations(reservation_id, created_at);

        CREATE TABLE resvary_grant_policy_applications (
          id TEXT PRIMARY KEY,
          policy_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          customer_id TEXT NOT NULL,
          policy_type TEXT NOT NULL,
          period_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          payload TEXT NOT NULL,
          UNIQUE(policy_id, account_id, period_key)
        );
        CREATE INDEX resvary_grant_policy_applications_customer
          ON resvary_grant_policy_applications(project_id, customer_id, created_at);
      `);

      const accounts = this.db
        .prepare('SELECT payload FROM resvary_credit_accounts ORDER BY id')
        .all() as PayloadRow[];
      for (const accountRow of accounts) {
        const account = parseReceiptStoreValue<CreditAccount>(accountRow.payload);
        const posted = parseCreditUnits(account.postedUnits);
        const reserved = parseCreditUnits(account.reservedUnits);
        if (reserved > posted) {
          throw new Error(
            `Cannot migrate SQLite credit lots: account invariant failed for ${account.id}`,
          );
        }
        const reservations = this.db
          .prepare(
            `SELECT payload FROM resvary_credit_reservations
             WHERE account_id = ? AND status = 'open' ORDER BY created_at, id`,
          )
          .all(account.id) as PayloadRow[];
        const open = reservations.map((item) =>
          parseReceiptStoreValue<CreditReservation>(item.payload),
        );
        const reservationTotal = open.reduce(
          (total, reservation) => total + parseCreditUnits(reservation.reservedUnits),
          0n,
        );
        if (reservationTotal !== reserved) {
          throw new Error(
            `Cannot migrate SQLite credit lots: open reservations do not match account ${account.id}`,
          );
        }
        if (posted === 0n) continue;
        const lotId = `lot_legacy_${account.id}`;
        const available = posted - reserved;
        const lot: CreditLot = {
          id: lotId,
          accountId: account.id,
          projectId: account.projectId,
          customerId: account.customerId,
          kind: 'legacy',
          originalAmount: creditUnitsToString(posted),
          originalUnits: posted.toString(),
          availableAmount: creditUnitsToString(available),
          availableUnits: available.toString(),
          reservedAmount: creditUnitsToString(reserved),
          reservedUnits: reserved.toString(),
          consumedAmount: '0',
          consumedUnits: '0',
          expiredAmount: '0',
          expiredUnits: '0',
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          metadata: { migratedFrom: 'sqlite-v4' },
        };
        insert(
          this.db,
          'resvary_credit_lots',
          [
            'id',
            'account_id',
            'project_id',
            'customer_id',
            'kind',
            'policy_id',
            'expires_at',
            'created_at',
          ],
          [
            lot.id,
            lot.accountId,
            lot.projectId,
            lot.customerId,
            lot.kind,
            null,
            null,
            lot.createdAt,
          ],
          lot,
        );
        for (const reservation of open) {
          const units = parseCreditUnits(reservation.reservedUnits);
          if (units === 0n) continue;
          const allocation: CreditLotAllocation = {
            id: `cla_legacy_${reservation.id}`,
            reservationId: reservation.id,
            lotId,
            accountId: account.id,
            projectId: account.projectId,
            customerId: account.customerId,
            allocatedAmount: creditUnitsToString(units),
            allocatedUnits: units.toString(),
            reservedAmount: creditUnitsToString(units),
            reservedUnits: units.toString(),
            consumedAmount: '0',
            consumedUnits: '0',
            releasedAmount: '0',
            releasedUnits: '0',
            expiredAmount: '0',
            expiredUnits: '0',
            createdAt: reservation.createdAt,
            updatedAt: account.updatedAt,
          };
          insert(
            this.db,
            'resvary_credit_lot_allocations',
            ['id', 'reservation_id', 'lot_id', 'account_id', 'created_at'],
            [
              allocation.id,
              allocation.reservationId,
              allocation.lotId,
              allocation.accountId,
              allocation.createdAt,
            ],
            allocation,
          );
        }
      }

      this.db
        .prepare('INSERT INTO resvary_schema_migrations(version, applied_at) VALUES (5, ?)')
        .run(Date.now());
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }
}

class SqliteCreditTransaction implements CreditPolicyStoreTransaction {
  constructor(private readonly db: DatabaseSyncType) {}
  getAccount(id: string) {
    return reader(this.db).getAccount(id);
  }
  getAccountByCustomer(projectId: string, customerId: string) {
    return reader(this.db).getAccountByCustomer(projectId, customerId);
  }
  listAccounts(filter?: CreditBalanceFilter) {
    return reader(this.db).listAccounts(filter);
  }
  getGrant(id: string) {
    return reader(this.db).getGrant(id);
  }
  listGrants(accountId?: string) {
    return reader(this.db).listGrants(accountId);
  }
  getMeter(id: string) {
    return reader(this.db).getMeter(id);
  }
  getMeterByKey(projectId: string, key: string) {
    return reader(this.db).getMeterByKey(projectId, key);
  }
  getPriceVersion(id: string) {
    return reader(this.db).getPriceVersion(id);
  }
  listPriceVersions(meterId?: string) {
    return reader(this.db).listPriceVersions(meterId);
  }
  getReservation(id: string) {
    return reader(this.db).getReservation(id);
  }
  listReservations(filter?: CreditReservationFilter) {
    return reader(this.db).listReservations(filter);
  }
  getUsageEvent(id: string) {
    return reader(this.db).getUsageEvent(id);
  }
  getUsageReceipt(id: string) {
    return reader(this.db).getUsageReceipt(id);
  }
  listUsageReceipts(accountId?: string) {
    return reader(this.db).listUsageReceipts(accountId);
  }
  listLedgerEntries(accountId?: string) {
    return reader(this.db).listLedgerEntries(accountId);
  }
  getOutboxEvent(id: string) {
    return reader(this.db).getOutboxEvent(id);
  }
  listOutboxEvents(filter?: OutboxEventFilter) {
    return reader(this.db).listOutboxEvents(filter);
  }
  getIdempotencyRecord(scope: string, key: string) {
    return reader(this.db).getIdempotencyRecord(scope, key);
  }
  getFundingIntent(id: string) {
    return reader(this.db).getFundingIntent(id);
  }
  listFundingIntents(projectId?: string) {
    return reader(this.db).listFundingIntents(projectId);
  }
  getFundingTransaction(id: string) {
    return reader(this.db).getFundingTransaction(id);
  }
  getFundingTransactionByExternalPayment(
    rail: FundingTransaction['rail'],
    network: string,
    externalPaymentId: string,
  ) {
    return reader(this.db).getFundingTransactionByExternalPayment(rail, network, externalPaymentId);
  }
  getFundingTransactionByTxHash(network: string, txHash: `0x${string}`) {
    return reader(this.db).getFundingTransactionByTxHash(network, txHash);
  }
  listFundingTransactions(fundingIntentId?: string) {
    return reader(this.db).listFundingTransactions(fundingIntentId);
  }
  getGrantPolicy(id: string) {
    return reader(this.db).getGrantPolicy(id);
  }
  listGrantPolicies(projectId?: string) {
    return reader(this.db).listGrantPolicies(projectId);
  }
  getCreditLot(id: string) {
    return reader(this.db).getCreditLot(id);
  }
  listCreditLots(filter?: CreditLotFilter) {
    return reader(this.db).listCreditLots(filter);
  }
  listCreditLotAllocations(reservationId?: string) {
    return reader(this.db).listCreditLotAllocations(reservationId);
  }
  getGrantPolicyApplication(id: string) {
    return reader(this.db).getGrantPolicyApplication(id);
  }
  getGrantPolicyApplicationByIdentity(policyId: string, accountId: string, periodKey: string) {
    return reader(this.db).getGrantPolicyApplicationByIdentity(policyId, accountId, periodKey);
  }
  listGrantPolicyApplications(filter?: GrantPolicyApplicationFilter) {
    return reader(this.db).listGrantPolicyApplications(filter);
  }

  async saveAccount(value: CreditAccount) {
    upsert(
      this.db,
      'resvary_credit_accounts',
      ['id', 'project_id', 'customer_id', 'updated_at'],
      [value.id, value.projectId, value.customerId, value.updatedAt],
      value,
    );
  }
  async saveGrant(value: CreditGrant) {
    insert(
      this.db,
      'resvary_credit_grants',
      ['id', 'account_id', 'created_at'],
      [value.id, value.accountId, value.createdAt],
      value,
    );
  }
  async saveMeter(value: MeterDefinition) {
    insert(
      this.db,
      'resvary_meters',
      ['id', 'project_id', 'meter_key'],
      [value.id, value.projectId, value.key],
      value,
    );
  }
  async savePriceVersion(value: PriceVersion) {
    insert(
      this.db,
      'resvary_price_versions',
      ['id', 'meter_id', 'version', 'created_at'],
      [value.id, value.meterId, value.version, value.createdAt],
      value,
    );
  }
  async saveReservation(value: CreditReservation) {
    upsert(
      this.db,
      'resvary_credit_reservations',
      ['id', 'account_id', 'project_id', 'customer_id', 'status', 'expires_at', 'created_at'],
      [
        value.id,
        value.accountId,
        value.projectId,
        value.customerId,
        value.status,
        value.expiresAt,
        value.createdAt,
      ],
      value,
    );
  }
  async saveUsageEvent(value: UsageEvent) {
    insert(
      this.db,
      'resvary_usage_events',
      ['id', 'account_id', 'received_at'],
      [value.id, value.accountId, value.receivedAt],
      value,
    );
  }
  async saveUsageReceipt(value: UsageReceipt) {
    insert(
      this.db,
      'resvary_usage_receipts',
      ['id', 'account_id', 'reservation_id', 'usage_event_id', 'created_at'],
      [value.id, value.accountId, value.reservationId, value.usageEventId, value.createdAt],
      value,
    );
  }
  async saveLedgerEntry(value: LedgerEntry) {
    insert(
      this.db,
      'resvary_ledger_entries',
      ['id', 'account_id', 'created_at'],
      [value.id, value.accountId, value.createdAt],
      value,
    );
  }
  async saveOutboxEvent(value: CreditOutboxEvent) {
    upsert(
      this.db,
      'resvary_outbox_events',
      [
        'id',
        'project_id',
        'type',
        'status',
        'created_at',
        'attempt_count',
        'next_attempt_at',
        'lease_owner',
        'lease_expires_at',
      ],
      [
        value.id,
        value.projectId,
        value.type,
        value.status,
        value.createdAt,
        value.attemptCount,
        value.nextAttemptAt,
        value.leaseOwner ?? null,
        value.leaseExpiresAt ?? null,
      ],
      value,
    );
  }
  async saveIdempotencyRecord(value: IdempotencyRecord) {
    insert(
      this.db,
      'resvary_idempotency_keys',
      ['scope', 'key', 'created_at'],
      [value.scope, value.key, value.createdAt],
      value,
      ['scope', 'key'],
    );
  }
  async saveFundingIntent(value: FundingIntent) {
    upsert(
      this.db,
      'resvary_funding_intents',
      ['id', 'project_id', 'customer_id', 'status', 'created_at'],
      [value.id, value.projectId, value.customerId, value.status, value.createdAt],
      value,
    );
  }
  async saveFundingTransaction(value: FundingTransaction) {
    upsert(
      this.db,
      'resvary_funding_transactions',
      [
        'id',
        'funding_intent_id',
        'rail',
        'network',
        'external_payment_id_norm',
        'tx_hash_norm',
        'created_at',
      ],
      [
        value.id,
        value.fundingIntentId,
        value.rail,
        value.network,
        value.externalPaymentId.toLowerCase(),
        value.txHash?.toLowerCase() ?? `external:${value.externalPaymentId.toLowerCase()}`,
        value.createdAt,
      ],
      value,
    );
  }
  async saveGrantPolicy(value: CreditGrantPolicy) {
    insert(
      this.db,
      'resvary_grant_policies',
      ['id', 'project_id', 'policy_key', 'version', 'created_at'],
      [value.id, value.projectId, value.key, value.version, value.createdAt],
      value,
    );
  }
  async saveCreditLot(value: CreditLot) {
    upsert(
      this.db,
      'resvary_credit_lots',
      [
        'id',
        'account_id',
        'project_id',
        'customer_id',
        'kind',
        'policy_id',
        'expires_at',
        'created_at',
      ],
      [
        value.id,
        value.accountId,
        value.projectId,
        value.customerId,
        value.kind,
        value.policyId ?? null,
        value.expiresAt ?? null,
        value.createdAt,
      ],
      value,
    );
  }
  async saveCreditLotAllocation(value: CreditLotAllocation) {
    upsert(
      this.db,
      'resvary_credit_lot_allocations',
      ['id', 'reservation_id', 'lot_id', 'account_id', 'created_at'],
      [value.id, value.reservationId, value.lotId, value.accountId, value.createdAt],
      value,
    );
  }
  async saveGrantPolicyApplication(value: GrantPolicyApplication) {
    insert(
      this.db,
      'resvary_grant_policy_applications',
      [
        'id',
        'policy_id',
        'account_id',
        'project_id',
        'customer_id',
        'policy_type',
        'period_key',
        'created_at',
      ],
      [
        value.id,
        value.policyId,
        value.accountId,
        value.projectId,
        value.customerId,
        value.policyType,
        value.periodKey,
        value.createdAt,
      ],
      value,
    );
  }
}

function reader(db: DatabaseSyncType): CreditStoreReader & CreditPolicyStoreReader {
  return {
    async getAccount(id) {
      return one<CreditAccount>(db, 'SELECT payload FROM resvary_credit_accounts WHERE id = ?', [
        id,
      ]);
    },
    async getAccountByCustomer(projectId, customerId) {
      return one<CreditAccount>(
        db,
        'SELECT payload FROM resvary_credit_accounts WHERE project_id = ? AND customer_id = ?',
        [projectId, customerId],
      );
    },
    async listAccounts(filter = {}) {
      return all<CreditAccount>(
        db,
        'SELECT payload FROM resvary_credit_accounts ORDER BY updated_at ASC',
      ).filter((item) => matchesBalanceFilter(item, filter));
    },
    async getGrant(id) {
      return one<CreditGrant>(db, 'SELECT payload FROM resvary_credit_grants WHERE id = ?', [id]);
    },
    async listGrants(accountId) {
      return accountId
        ? all<CreditGrant>(
            db,
            'SELECT payload FROM resvary_credit_grants WHERE account_id = ? ORDER BY created_at ASC',
            [accountId],
          )
        : all<CreditGrant>(db, 'SELECT payload FROM resvary_credit_grants ORDER BY created_at ASC');
    },
    async getMeter(id) {
      return one<MeterDefinition>(db, 'SELECT payload FROM resvary_meters WHERE id = ?', [id]);
    },
    async getMeterByKey(projectId, key) {
      return one<MeterDefinition>(
        db,
        'SELECT payload FROM resvary_meters WHERE project_id = ? AND meter_key = ?',
        [projectId, key],
      );
    },
    async getPriceVersion(id) {
      return one<PriceVersion>(db, 'SELECT payload FROM resvary_price_versions WHERE id = ?', [id]);
    },
    async listPriceVersions(meterId) {
      return meterId
        ? all<PriceVersion>(
            db,
            'SELECT payload FROM resvary_price_versions WHERE meter_id = ? ORDER BY version ASC',
            [meterId],
          )
        : all<PriceVersion>(
            db,
            'SELECT payload FROM resvary_price_versions ORDER BY created_at ASC',
          );
    },
    async getReservation(id) {
      return one<CreditReservation>(
        db,
        'SELECT payload FROM resvary_credit_reservations WHERE id = ?',
        [id],
      );
    },
    async listReservations(filter = {}) {
      return all<CreditReservation>(
        db,
        'SELECT payload FROM resvary_credit_reservations ORDER BY created_at ASC',
      ).filter(
        (item) =>
          matchesBalanceFilter(item, filter) && (!filter.status || item.status === filter.status),
      );
    },
    async getUsageEvent(id) {
      return one<UsageEvent>(db, 'SELECT payload FROM resvary_usage_events WHERE id = ?', [id]);
    },
    async getUsageReceipt(id) {
      return one<UsageReceipt>(db, 'SELECT payload FROM resvary_usage_receipts WHERE id = ?', [id]);
    },
    async listUsageReceipts(accountId) {
      return accountId
        ? all<UsageReceipt>(
            db,
            'SELECT payload FROM resvary_usage_receipts WHERE account_id = ? ORDER BY created_at ASC',
            [accountId],
          )
        : all<UsageReceipt>(
            db,
            'SELECT payload FROM resvary_usage_receipts ORDER BY created_at ASC',
          );
    },
    async listLedgerEntries(accountId) {
      return accountId
        ? all<LedgerEntry>(
            db,
            'SELECT payload FROM resvary_ledger_entries WHERE account_id = ? ORDER BY created_at ASC, rowid ASC',
            [accountId],
          )
        : all<LedgerEntry>(
            db,
            'SELECT payload FROM resvary_ledger_entries ORDER BY created_at ASC, rowid ASC',
          );
    },
    async getOutboxEvent(id) {
      return one<CreditOutboxEvent>(db, 'SELECT payload FROM resvary_outbox_events WHERE id = ?', [
        id,
      ]);
    },
    async listOutboxEvents(filter = {}) {
      return all<CreditOutboxEvent>(
        db,
        'SELECT payload FROM resvary_outbox_events ORDER BY created_at ASC, rowid ASC',
      ).filter(
        (item) =>
          (!filter.projectId || item.projectId === filter.projectId) &&
          (!filter.status || item.status === filter.status) &&
          (!filter.type || item.type === filter.type),
      );
    },
    async getIdempotencyRecord(scope, key) {
      return one<IdempotencyRecord>(
        db,
        'SELECT payload FROM resvary_idempotency_keys WHERE scope = ? AND key = ?',
        [scope, key],
      );
    },
    async getFundingIntent(id) {
      return one<FundingIntent>(db, 'SELECT payload FROM resvary_funding_intents WHERE id = ?', [
        id,
      ]);
    },
    async listFundingIntents(projectId) {
      return projectId
        ? all<FundingIntent>(
            db,
            'SELECT payload FROM resvary_funding_intents WHERE project_id = ? ORDER BY created_at ASC',
            [projectId],
          )
        : all<FundingIntent>(
            db,
            'SELECT payload FROM resvary_funding_intents ORDER BY created_at ASC',
          );
    },
    async getFundingTransaction(id) {
      return one<FundingTransaction>(
        db,
        'SELECT payload FROM resvary_funding_transactions WHERE id = ?',
        [id],
      );
    },
    async getFundingTransactionByExternalPayment(rail, network, externalPaymentId) {
      return one<FundingTransaction>(
        db,
        `SELECT payload FROM resvary_funding_transactions
         WHERE rail = ? AND network = ? AND external_payment_id_norm = ?`,
        [rail, network, externalPaymentId.toLowerCase()],
      );
    },
    async getFundingTransactionByTxHash(network, txHash) {
      return one<FundingTransaction>(
        db,
        'SELECT payload FROM resvary_funding_transactions WHERE network = ? AND tx_hash_norm = ?',
        [network, txHash.toLowerCase()],
      );
    },
    async listFundingTransactions(fundingIntentId) {
      return fundingIntentId
        ? all<FundingTransaction>(
            db,
            'SELECT payload FROM resvary_funding_transactions WHERE funding_intent_id = ? ORDER BY created_at ASC',
            [fundingIntentId],
          )
        : all<FundingTransaction>(
            db,
            'SELECT payload FROM resvary_funding_transactions ORDER BY created_at ASC',
          );
    },
    async getGrantPolicy(id) {
      return one<CreditGrantPolicy>(db, 'SELECT payload FROM resvary_grant_policies WHERE id = ?', [
        id,
      ]);
    },
    async listGrantPolicies(projectId) {
      return projectId
        ? all<CreditGrantPolicy>(
            db,
            'SELECT payload FROM resvary_grant_policies WHERE project_id = ? ORDER BY created_at, version',
            [projectId],
          )
        : all<CreditGrantPolicy>(
            db,
            'SELECT payload FROM resvary_grant_policies ORDER BY created_at, version',
          );
    },
    async getCreditLot(id) {
      return one<CreditLot>(db, 'SELECT payload FROM resvary_credit_lots WHERE id = ?', [id]);
    },
    async listCreditLots(filter = {}) {
      return all<CreditLot>(
        db,
        'SELECT payload FROM resvary_credit_lots ORDER BY created_at, id',
      ).filter(
        (item) =>
          matchesBalanceFilter(item, filter) &&
          (!filter.policyId || item.policyId === filter.policyId) &&
          (!filter.kind || item.kind === filter.kind) &&
          (filter.expiresBefore === undefined ||
            (item.expiresAt !== undefined && item.expiresAt <= filter.expiresBefore)),
      );
    },
    async listCreditLotAllocations(reservationId) {
      return reservationId
        ? all<CreditLotAllocation>(
            db,
            'SELECT payload FROM resvary_credit_lot_allocations WHERE reservation_id = ? ORDER BY created_at, id',
            [reservationId],
          )
        : all<CreditLotAllocation>(
            db,
            'SELECT payload FROM resvary_credit_lot_allocations ORDER BY created_at, id',
          );
    },
    async getGrantPolicyApplication(id) {
      return one<GrantPolicyApplication>(
        db,
        'SELECT payload FROM resvary_grant_policy_applications WHERE id = ?',
        [id],
      );
    },
    async getGrantPolicyApplicationByIdentity(policyId, accountId, periodKey) {
      return one<GrantPolicyApplication>(
        db,
        `SELECT payload FROM resvary_grant_policy_applications
         WHERE policy_id = ? AND account_id = ? AND period_key = ?`,
        [policyId, accountId, periodKey],
      );
    },
    async listGrantPolicyApplications(filter = {}) {
      return all<GrantPolicyApplication>(
        db,
        'SELECT payload FROM resvary_grant_policy_applications ORDER BY created_at, id',
      ).filter(
        (item) =>
          matchesBalanceFilter(item, filter) &&
          (!filter.policyId || item.policyId === filter.policyId) &&
          (!filter.policyType || item.policyType === filter.policyType) &&
          (!filter.periodKey || item.periodKey === filter.periodKey),
      );
    },
  };
}

function insert(
  db: DatabaseSyncType,
  table: string,
  columns: string[],
  values: unknown[],
  payload: unknown,
  conflictColumns: string[] = ['id'],
): void {
  const allColumns = [...columns, 'payload'];
  const placeholders = allColumns.map(() => '?').join(', ');
  const conflict = conflictColumns.join(', ');
  db.prepare(
    `INSERT INTO ${table} (${allColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${conflict}) DO NOTHING`,
  ).run(...values, serializeReceiptStoreValue(payload));
}

function upsert(
  db: DatabaseSyncType,
  table: string,
  columns: string[],
  values: unknown[],
  payload: unknown,
): void {
  const allColumns = [...columns, 'payload'];
  const placeholders = allColumns.map(() => '?').join(', ');
  const updates = allColumns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');
  db.prepare(
    `INSERT INTO ${table} (${allColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
  ).run(...values, serializeReceiptStoreValue(payload));
}

function one<T>(db: DatabaseSyncType, sql: string, params: unknown[] = []): T | undefined {
  return parseRow<T>(db.prepare(sql).get(...params));
}
function all<T>(db: DatabaseSyncType, sql: string, params: unknown[] = []): T[] {
  return db
    .prepare(sql)
    .all(...params)
    .map((row) => parseRow<T>(row)!)
    .filter(Boolean);
}
function parseRow<T>(row: unknown): T | undefined {
  if (
    !row ||
    typeof row !== 'object' ||
    !('payload' in row) ||
    typeof (row as PayloadRow).payload !== 'string'
  )
    return undefined;
  return parseReceiptStoreValue<T>((row as PayloadRow).payload);
}
function matchesBalanceFilter(
  value: { projectId: string; customerId: string },
  filter: CreditBalanceFilter,
): boolean {
  return (
    (!filter.projectId || value.projectId === filter.projectId) &&
    (!filter.customerId || value.customerId === filter.customerId)
  );
}

export function createSqliteCreditStore(config: SqliteCreditStoreConfig): SqliteCreditStore {
  return new SqliteCreditStore(config);
}

async function requireClaimedEvent(
  tx: CreditStoreTransaction,
  eventId: string,
  workerId: string,
  attemptCount?: number,
): Promise<CreditOutboxEvent> {
  const event = await tx.getOutboxEvent(eventId);
  if (!event) throw new Error(`Outbox event not found: ${eventId}`);
  if (event.status !== 'processing' || event.leaseOwner !== workerId) {
    throw new Error(`Outbox event is not leased by worker ${workerId}: ${eventId}`);
  }
  if (attemptCount !== undefined && event.attemptCount !== attemptCount) {
    throw new Error(`Outbox lease attempt changed for event ${eventId}`);
  }
  return event;
}
