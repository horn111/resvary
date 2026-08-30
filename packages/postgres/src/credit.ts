import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type {
  ClaimOutboxEventsInput,
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
  CreditPolicyStore,
  CreditPolicyStoreReader,
  CreditPolicyStoreTransaction,
  FailOutboxEventInput,
  FundingIntent,
  FundingTransaction,
  GrantPolicyApplication,
  GrantPolicyApplicationFilter,
  IdempotencyRecord,
  LedgerEntry,
  MeterDefinition,
  OutboxDeliveryStore,
  OutboxEventFilter,
  PriceVersion,
  UsageEvent,
  UsageReceipt,
} from '@resvary/sdk/credits';
import { parseReceiptStoreValue, serializeReceiptStoreValue } from '@resvary/sdk/receipts';
import {
  createPostgresHandle,
  isRetryableTransactionError,
  rollback,
  table,
  type PostgresConnectionConfig,
  type PostgresHandle,
} from './connection.js';

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

type PayloadRow = { payload: string };
type OutboxRow = PayloadRow & {
  status: CreditOutboxEvent['status'];
  attempt_count: number;
  next_attempt_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  delivered_at: string | null;
};

export interface PostgresCreditStoreConfig extends PostgresConnectionConfig {}

export class PostgresCreditStore implements CreditPolicyStore, OutboxDeliveryStore {
  private readonly handle: PostgresHandle;

  constructor(config: PostgresCreditStoreConfig) {
    this.handle = createPostgresHandle(config);
  }

  async transaction<T>(
    handler: (transaction: CreditPolicyStoreTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const client = await this.handle.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const result = await handler(new PostgresCreditTransaction(client, this.handle));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await rollback(client);
        if (!isRetryableTransactionError(error) || attempt >= this.handle.maxTransactionRetries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(10 * 2 ** attempt, 250)));
      } finally {
        client.release();
      }
    }
  }

  getAccount(id: string) {
    return reader(this.handle.pool, this.handle).getAccount(id);
  }
  getAccountByCustomer(projectId: string, customerId: string) {
    return reader(this.handle.pool, this.handle).getAccountByCustomer(projectId, customerId);
  }
  listAccounts(filter?: CreditBalanceFilter) {
    return reader(this.handle.pool, this.handle).listAccounts(filter);
  }
  getGrant(id: string) {
    return reader(this.handle.pool, this.handle).getGrant(id);
  }
  listGrants(accountId?: string) {
    return reader(this.handle.pool, this.handle).listGrants(accountId);
  }
  getMeter(id: string) {
    return reader(this.handle.pool, this.handle).getMeter(id);
  }
  getMeterByKey(projectId: string, key: string) {
    return reader(this.handle.pool, this.handle).getMeterByKey(projectId, key);
  }
  getPriceVersion(id: string) {
    return reader(this.handle.pool, this.handle).getPriceVersion(id);
  }
  listPriceVersions(meterId?: string) {
    return reader(this.handle.pool, this.handle).listPriceVersions(meterId);
  }
  getReservation(id: string) {
    return reader(this.handle.pool, this.handle).getReservation(id);
  }
  listReservations(filter?: CreditReservationFilter) {
    return reader(this.handle.pool, this.handle).listReservations(filter);
  }
  getUsageEvent(id: string) {
    return reader(this.handle.pool, this.handle).getUsageEvent(id);
  }
  getUsageReceipt(id: string) {
    return reader(this.handle.pool, this.handle).getUsageReceipt(id);
  }
  listUsageReceipts(accountId?: string) {
    return reader(this.handle.pool, this.handle).listUsageReceipts(accountId);
  }
  listLedgerEntries(accountId?: string) {
    return reader(this.handle.pool, this.handle).listLedgerEntries(accountId);
  }
  getOutboxEvent(id: string) {
    return reader(this.handle.pool, this.handle).getOutboxEvent(id);
  }
  listOutboxEvents(filter?: OutboxEventFilter) {
    return reader(this.handle.pool, this.handle).listOutboxEvents(filter);
  }
  getIdempotencyRecord(scope: string, key: string) {
    return reader(this.handle.pool, this.handle).getIdempotencyRecord(scope, key);
  }
  getFundingIntent(id: string) {
    return reader(this.handle.pool, this.handle).getFundingIntent(id);
  }
  listFundingIntents(projectId?: string) {
    return reader(this.handle.pool, this.handle).listFundingIntents(projectId);
  }
  getFundingTransaction(id: string) {
    return reader(this.handle.pool, this.handle).getFundingTransaction(id);
  }
  getFundingTransactionByExternalPayment(
    rail: FundingTransaction['rail'],
    network: string,
    externalPaymentId: string,
  ) {
    return reader(this.handle.pool, this.handle).getFundingTransactionByExternalPayment(
      rail,
      network,
      externalPaymentId,
    );
  }
  getFundingTransactionByTxHash(network: string, txHash: `0x${string}`) {
    return reader(this.handle.pool, this.handle).getFundingTransactionByTxHash(network, txHash);
  }
  listFundingTransactions(fundingIntentId?: string) {
    return reader(this.handle.pool, this.handle).listFundingTransactions(fundingIntentId);
  }
  getGrantPolicy(id: string) {
    return reader(this.handle.pool, this.handle).getGrantPolicy(id);
  }
  listGrantPolicies(projectId?: string) {
    return reader(this.handle.pool, this.handle).listGrantPolicies(projectId);
  }
  getCreditLot(id: string) {
    return reader(this.handle.pool, this.handle).getCreditLot(id);
  }
  listCreditLots(filter?: CreditLotFilter) {
    return reader(this.handle.pool, this.handle).listCreditLots(filter);
  }
  listCreditLotAllocations(reservationId?: string) {
    return reader(this.handle.pool, this.handle).listCreditLotAllocations(reservationId);
  }
  getGrantPolicyApplication(id: string) {
    return reader(this.handle.pool, this.handle).getGrantPolicyApplication(id);
  }
  getGrantPolicyApplicationByIdentity(policyId: string, accountId: string, periodKey: string) {
    return reader(this.handle.pool, this.handle).getGrantPolicyApplicationByIdentity(
      policyId,
      accountId,
      periodKey,
    );
  }
  listGrantPolicyApplications(filter?: GrantPolicyApplicationFilter) {
    return reader(this.handle.pool, this.handle).listGrantPolicyApplications(filter);
  }

  async claimOutboxEvents(input: ClaimOutboxEventsInput): Promise<CreditOutboxEvent[]> {
    const outbox = table(this.handle, 'resvary_outbox_events');
    const result = await this.handle.pool.query<OutboxRow>(
      `WITH candidates AS (
         SELECT id FROM ${outbox}
         WHERE ($5::text IS NULL OR project_id = $5)
           AND ((status = 'pending' AND next_attempt_at <= $1)
             OR (status = 'processing' AND lease_expires_at <= $1))
         ORDER BY next_attempt_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE ${outbox} AS event
       SET status = 'processing', attempt_count = event.attempt_count + 1,
           lease_owner = $3, lease_expires_at = $1 + $4, last_attempt_at = $1
       FROM candidates
       WHERE event.id = candidates.id
       RETURNING event.payload::text AS payload, event.status, event.attempt_count,
         event.next_attempt_at::text, event.lease_owner, event.lease_expires_at::text,
         event.last_attempt_at::text, event.last_error, event.delivered_at::text`,
      [input.now, input.limit, input.workerId, input.leaseMs, input.projectId ?? null],
    );
    return result.rows.map(parseOutboxRow);
  }

  async completeOutboxEvent(
    eventId: string,
    workerId: string,
    deliveredAt: number,
    attemptCount?: number,
  ): Promise<void> {
    const result = await this.handle.pool.query(
      `UPDATE ${table(this.handle, 'resvary_outbox_events')}
       SET status = 'delivered', delivered_at = $3, next_attempt_at = $3,
           lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
       WHERE id = $1 AND status = 'processing' AND lease_owner = $2
         AND ($4::integer IS NULL OR attempt_count = $4)`,
      [eventId, workerId, deliveredAt, attemptCount ?? null],
    );
    if (result.rowCount !== 1) throw new Error(`Outbox lease lost for event ${eventId}`);
  }

  async failOutboxEvent(input: FailOutboxEventInput): Promise<void> {
    const result = await this.handle.pool.query(
      `UPDATE ${table(this.handle, 'resvary_outbox_events')}
       SET status = $4, next_attempt_at = $5, lease_owner = NULL,
           lease_expires_at = NULL, last_error = $3
        WHERE id = $1 AND status = 'processing' AND lease_owner = $2
          AND ($6::integer IS NULL OR attempt_count = $6)`,
      [
        input.eventId,
        input.workerId,
        input.error,
        input.deadLetter ? 'dead_letter' : 'pending',
        input.nextAttemptAt,
        input.attemptCount ?? null,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`Outbox lease lost for event ${input.eventId}`);
  }

  listDeadLetterEvents(projectId?: string): Promise<CreditOutboxEvent[]> {
    return this.listOutboxEvents({ projectId, status: 'dead_letter' });
  }

  async requeueOutboxEvent(eventId: string, now: number): Promise<void> {
    const result = await this.handle.pool.query(
      `UPDATE ${table(this.handle, 'resvary_outbox_events')}
       SET status = 'pending', attempt_count = 0, next_attempt_at = $2,
           lease_owner = NULL, lease_expires_at = NULL, last_error = NULL, delivered_at = NULL
       WHERE id = $1 AND status = 'dead_letter'`,
      [eventId, now],
    );
    if (result.rowCount !== 1) throw new Error(`Dead-letter event not found: ${eventId}`);
  }

  async close(): Promise<void> {
    if (this.handle.ownsPool) await this.handle.pool.end();
  }
}

class PostgresCreditTransaction implements CreditPolicyStoreTransaction {
  constructor(
    private readonly client: PoolClient,
    private readonly handle: PostgresHandle,
  ) {}

  getAccount(id: string) {
    return reader(this.client, this.handle).getAccount(id);
  }
  getAccountByCustomer(projectId: string, customerId: string) {
    return reader(this.client, this.handle).getAccountByCustomer(projectId, customerId);
  }
  listAccounts(filter?: CreditBalanceFilter) {
    return reader(this.client, this.handle).listAccounts(filter);
  }
  getGrant(id: string) {
    return reader(this.client, this.handle).getGrant(id);
  }
  listGrants(accountId?: string) {
    return reader(this.client, this.handle).listGrants(accountId);
  }
  getMeter(id: string) {
    return reader(this.client, this.handle).getMeter(id);
  }
  getMeterByKey(projectId: string, key: string) {
    return reader(this.client, this.handle).getMeterByKey(projectId, key);
  }
  getPriceVersion(id: string) {
    return reader(this.client, this.handle).getPriceVersion(id);
  }
  listPriceVersions(meterId?: string) {
    return reader(this.client, this.handle).listPriceVersions(meterId);
  }
  getReservation(id: string) {
    return reader(this.client, this.handle).getReservation(id);
  }
  listReservations(filter?: CreditReservationFilter) {
    return reader(this.client, this.handle).listReservations(filter);
  }
  getUsageEvent(id: string) {
    return reader(this.client, this.handle).getUsageEvent(id);
  }
  getUsageReceipt(id: string) {
    return reader(this.client, this.handle).getUsageReceipt(id);
  }
  listUsageReceipts(accountId?: string) {
    return reader(this.client, this.handle).listUsageReceipts(accountId);
  }
  listLedgerEntries(accountId?: string) {
    return reader(this.client, this.handle).listLedgerEntries(accountId);
  }
  getOutboxEvent(id: string) {
    return reader(this.client, this.handle).getOutboxEvent(id);
  }
  listOutboxEvents(filter?: OutboxEventFilter) {
    return reader(this.client, this.handle).listOutboxEvents(filter);
  }
  getIdempotencyRecord(scope: string, key: string) {
    return reader(this.client, this.handle).getIdempotencyRecord(scope, key);
  }
  getFundingIntent(id: string) {
    return reader(this.client, this.handle).getFundingIntent(id);
  }
  listFundingIntents(projectId?: string) {
    return reader(this.client, this.handle).listFundingIntents(projectId);
  }
  getFundingTransaction(id: string) {
    return reader(this.client, this.handle).getFundingTransaction(id);
  }
  getFundingTransactionByExternalPayment(
    rail: FundingTransaction['rail'],
    network: string,
    externalPaymentId: string,
  ) {
    return reader(this.client, this.handle).getFundingTransactionByExternalPayment(
      rail,
      network,
      externalPaymentId,
    );
  }
  getFundingTransactionByTxHash(network: string, txHash: `0x${string}`) {
    return reader(this.client, this.handle).getFundingTransactionByTxHash(network, txHash);
  }
  listFundingTransactions(fundingIntentId?: string) {
    return reader(this.client, this.handle).listFundingTransactions(fundingIntentId);
  }
  getGrantPolicy(id: string) {
    return reader(this.client, this.handle).getGrantPolicy(id);
  }
  listGrantPolicies(projectId?: string) {
    return reader(this.client, this.handle).listGrantPolicies(projectId);
  }
  getCreditLot(id: string) {
    return reader(this.client, this.handle).getCreditLot(id);
  }
  listCreditLots(filter?: CreditLotFilter) {
    return reader(this.client, this.handle).listCreditLots(filter);
  }
  listCreditLotAllocations(reservationId?: string) {
    return reader(this.client, this.handle).listCreditLotAllocations(reservationId);
  }
  getGrantPolicyApplication(id: string) {
    return reader(this.client, this.handle).getGrantPolicyApplication(id);
  }
  getGrantPolicyApplicationByIdentity(policyId: string, accountId: string, periodKey: string) {
    return reader(this.client, this.handle).getGrantPolicyApplicationByIdentity(
      policyId,
      accountId,
      periodKey,
    );
  }
  listGrantPolicyApplications(filter?: GrantPolicyApplicationFilter) {
    return reader(this.client, this.handle).listGrantPolicyApplications(filter);
  }

  saveAccount(value: CreditAccount) {
    return upsert(
      this.client,
      this.handle,
      'resvary_credit_accounts',
      [
        'id',
        'project_id',
        'customer_id',
        'currency',
        'posted_units',
        'reserved_units',
        'updated_at',
      ],
      [
        value.id,
        value.projectId,
        value.customerId,
        value.currency,
        value.postedUnits,
        value.reservedUnits,
        value.updatedAt,
      ],
      value,
    );
  }
  saveGrant(value: CreditGrant) {
    return insert(
      this.client,
      this.handle,
      'resvary_credit_grants',
      ['id', 'account_id', 'amount_units', 'created_at'],
      [value.id, value.accountId, value.amountUnits, value.createdAt],
      value,
    );
  }
  saveMeter(value: MeterDefinition) {
    return insert(
      this.client,
      this.handle,
      'resvary_meters',
      ['id', 'project_id', 'meter_key'],
      [value.id, value.projectId, value.key],
      value,
    );
  }
  savePriceVersion(value: PriceVersion) {
    return insert(
      this.client,
      this.handle,
      'resvary_price_versions',
      ['id', 'meter_id', 'version', 'created_at'],
      [value.id, value.meterId, value.version, value.createdAt],
      value,
    );
  }
  saveReservation(value: CreditReservation) {
    return upsert(
      this.client,
      this.handle,
      'resvary_credit_reservations',
      [
        'id',
        'account_id',
        'project_id',
        'customer_id',
        'status',
        'reserved_units',
        'expires_at',
        'created_at',
      ],
      [
        value.id,
        value.accountId,
        value.projectId,
        value.customerId,
        value.status,
        value.reservedUnits,
        value.expiresAt,
        value.createdAt,
      ],
      value,
    );
  }
  saveUsageEvent(value: UsageEvent) {
    return insert(
      this.client,
      this.handle,
      'resvary_usage_events',
      ['id', 'account_id', 'received_at'],
      [value.id, value.accountId, value.receivedAt],
      value,
    );
  }
  saveUsageReceipt(value: UsageReceipt) {
    return insert(
      this.client,
      this.handle,
      'resvary_usage_receipts',
      ['id', 'account_id', 'reservation_id', 'usage_event_id', 'charged_units', 'created_at'],
      [
        value.id,
        value.accountId,
        value.reservationId,
        value.usageEventId,
        value.amountUnits,
        value.createdAt,
      ],
      value,
    );
  }
  saveLedgerEntry(value: LedgerEntry) {
    return insert(
      this.client,
      this.handle,
      'resvary_ledger_entries',
      ['id', 'account_id', 'delta_units', 'balance_after_units', 'created_at'],
      [value.id, value.accountId, value.deltaUnits, value.balanceAfterUnits, value.createdAt],
      value,
    );
  }
  saveOutboxEvent(value: CreditOutboxEvent) {
    return upsert(
      this.client,
      this.handle,
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
        'last_attempt_at',
        'last_error',
        'delivered_at',
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
        value.lastAttemptAt ?? null,
        value.lastError ?? null,
        value.deliveredAt ?? null,
      ],
      value,
    );
  }
  saveIdempotencyRecord(value: IdempotencyRecord) {
    return insert(
      this.client,
      this.handle,
      'resvary_idempotency_keys',
      ['scope', 'key', 'created_at'],
      [value.scope, value.key, value.createdAt],
      value,
      ['scope', 'key'],
    );
  }
  saveFundingIntent(value: FundingIntent) {
    return upsert(
      this.client,
      this.handle,
      'resvary_funding_intents',
      ['id', 'project_id', 'customer_id', 'status', 'requested_units', 'created_at'],
      [
        value.id,
        value.projectId,
        value.customerId,
        value.status,
        value.requestedUnits,
        value.createdAt,
      ],
      value,
    );
  }
  saveFundingTransaction(value: FundingTransaction) {
    return upsert(
      this.client,
      this.handle,
      'resvary_funding_transactions',
      [
        'id',
        'funding_intent_id',
        'rail',
        'network',
        'external_payment_id_norm',
        'tx_hash_norm',
        'amount_units',
        'created_at',
      ],
      [
        value.id,
        value.fundingIntentId,
        value.rail,
        value.network,
        value.externalPaymentId.toLowerCase(),
        value.txHash?.toLowerCase() ?? null,
        value.amountUnits,
        value.createdAt,
      ],
      value,
    );
  }
  saveGrantPolicy(value: CreditGrantPolicy) {
    return insert(
      this.client,
      this.handle,
      'resvary_grant_policies',
      ['id', 'project_id', 'policy_key', 'version', 'created_at'],
      [value.id, value.projectId, value.key, value.version, value.createdAt],
      value,
    );
  }
  saveCreditLot(value: CreditLot) {
    return upsert(
      this.client,
      this.handle,
      'resvary_credit_lots',
      [
        'id',
        'account_id',
        'project_id',
        'customer_id',
        'kind',
        'policy_id',
        'original_units',
        'available_units',
        'reserved_units',
        'consumed_units',
        'expired_units',
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
        value.originalUnits,
        value.availableUnits,
        value.reservedUnits,
        value.consumedUnits,
        value.expiredUnits,
        value.expiresAt ?? null,
        value.createdAt,
      ],
      value,
    );
  }
  saveCreditLotAllocation(value: CreditLotAllocation) {
    return upsert(
      this.client,
      this.handle,
      'resvary_credit_lot_allocations',
      [
        'id',
        'reservation_id',
        'lot_id',
        'account_id',
        'allocated_units',
        'reserved_units',
        'consumed_units',
        'released_units',
        'expired_units',
        'created_at',
      ],
      [
        value.id,
        value.reservationId,
        value.lotId,
        value.accountId,
        value.allocatedUnits,
        value.reservedUnits,
        value.consumedUnits,
        value.releasedUnits,
        value.expiredUnits,
        value.createdAt,
      ],
      value,
    );
  }
  saveGrantPolicyApplication(value: GrantPolicyApplication) {
    return insert(
      this.client,
      this.handle,
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

function reader(
  db: Queryable,
  handle: PostgresHandle,
): CreditStoreReader & CreditPolicyStoreReader {
  const t = (name: string) => table(handle, name);
  return {
    getAccount: (id) =>
      one(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_credit_accounts')} WHERE id = $1`,
        [id],
      ),
    getAccountByCustomer: (projectId, customerId) =>
      one(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_credit_accounts')} WHERE project_id = $1 AND customer_id = $2`,
        [projectId, customerId],
      ),
    listAccounts: (filter = {}) =>
      filteredAll(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_credit_accounts')} ORDER BY updated_at ASC`,
        [],
        (value: CreditAccount) => matchesBalanceFilter(value, filter),
      ),
    getGrant: (id) =>
      one(db, `SELECT payload::text AS payload FROM ${t('resvary_credit_grants')} WHERE id = $1`, [
        id,
      ]),
    listGrants: (accountId) =>
      all(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_credit_grants')} ${accountId ? 'WHERE account_id = $1' : ''} ORDER BY created_at ASC`,
        accountId ? [accountId] : [],
      ),
    getMeter: (id) =>
      one(db, `SELECT payload::text AS payload FROM ${t('resvary_meters')} WHERE id = $1`, [id]),
    getMeterByKey: (projectId, key) =>
      one(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_meters')} WHERE project_id = $1 AND meter_key = $2`,
        [projectId, key],
      ),
    getPriceVersion: (id) =>
      one(db, `SELECT payload::text AS payload FROM ${t('resvary_price_versions')} WHERE id = $1`, [
        id,
      ]),
    listPriceVersions: (meterId) =>
      all(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_price_versions')} ${meterId ? 'WHERE meter_id = $1' : ''} ORDER BY created_at ASC`,
        meterId ? [meterId] : [],
      ),
    getReservation: (id) =>
      one(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_credit_reservations')} WHERE id = $1`,
        [id],
      ),
    listReservations: (filter = {}) =>
      filteredAll(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_credit_reservations')} ORDER BY created_at ASC`,
        [],
        (value: CreditReservation) =>
          matchesBalanceFilter(value, filter) && (!filter.status || value.status === filter.status),
      ),
    getUsageEvent: (id) =>
      one(db, `SELECT payload::text AS payload FROM ${t('resvary_usage_events')} WHERE id = $1`, [
        id,
      ]),
    getUsageReceipt: (id) =>
      one(db, `SELECT payload::text AS payload FROM ${t('resvary_usage_receipts')} WHERE id = $1`, [
        id,
      ]),
    listUsageReceipts: (accountId) =>
      all(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_usage_receipts')} ${accountId ? 'WHERE account_id = $1' : ''} ORDER BY created_at ASC`,
        accountId ? [accountId] : [],
      ),
    listLedgerEntries: (accountId) =>
      all(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_ledger_entries')} ${accountId ? 'WHERE account_id = $1' : ''} ORDER BY created_at ASC, id ASC`,
        accountId ? [accountId] : [],
      ),
    getOutboxEvent: async (id) => {
      const result = await db.query<OutboxRow>(
        outboxSelect(t('resvary_outbox_events'), 'WHERE id = $1'),
        [id],
      );
      return result.rows[0] ? parseOutboxRow(result.rows[0]) : undefined;
    },
    listOutboxEvents: async (filter = {}) => {
      const result = await db.query<OutboxRow>(
        outboxSelect(t('resvary_outbox_events'), 'ORDER BY created_at ASC, id ASC'),
      );
      return result.rows
        .map(parseOutboxRow)
        .filter(
          (item) =>
            (!filter.projectId || item.projectId === filter.projectId) &&
            (!filter.status || item.status === filter.status) &&
            (!filter.type || item.type === filter.type),
        );
    },
    getIdempotencyRecord: (scope, key) =>
      one(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_idempotency_keys')} WHERE scope = $1 AND key = $2`,
        [scope, key],
      ),
    getFundingIntent: (id) =>
      one(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_funding_intents')} WHERE id = $1`,
        [id],
      ),
    listFundingIntents: (projectId) =>
      all(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_funding_intents')} ${projectId ? 'WHERE project_id = $1' : ''} ORDER BY created_at ASC`,
        projectId ? [projectId] : [],
      ),
    getFundingTransaction: (id) =>
      one(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_funding_transactions')} WHERE id = $1`,
        [id],
      ),
    getFundingTransactionByExternalPayment: (rail, network, externalPaymentId) =>
      one(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_funding_transactions')} WHERE rail = $1 AND network = $2 AND external_payment_id_norm = $3`,
        [rail, network, externalPaymentId.toLowerCase()],
      ),
    getFundingTransactionByTxHash: (network, txHash) =>
      one(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_funding_transactions')} WHERE network = $1 AND tx_hash_norm = $2`,
        [network, txHash.toLowerCase()],
      ),
    listFundingTransactions: (fundingIntentId) =>
      all(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_funding_transactions')} ${fundingIntentId ? 'WHERE funding_intent_id = $1' : ''} ORDER BY created_at ASC`,
        fundingIntentId ? [fundingIntentId] : [],
      ),
    getGrantPolicy: (id) =>
      one(db, `SELECT payload::text AS payload FROM ${t('resvary_grant_policies')} WHERE id = $1`, [
        id,
      ]),
    listGrantPolicies: (projectId) =>
      all(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_grant_policies')}
         ${projectId ? 'WHERE project_id = $1' : ''} ORDER BY created_at, version`,
        projectId ? [projectId] : [],
      ),
    getCreditLot: (id) =>
      one(db, `SELECT payload::text AS payload FROM ${t('resvary_credit_lots')} WHERE id = $1`, [
        id,
      ]),
    listCreditLots: (filter = {}) =>
      filteredAll(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_credit_lots')} ORDER BY created_at, id`,
        [],
        (value: CreditLot) =>
          matchesBalanceFilter(value, filter) &&
          (!filter.policyId || value.policyId === filter.policyId) &&
          (!filter.kind || value.kind === filter.kind) &&
          (filter.expiresBefore === undefined ||
            (value.expiresAt !== undefined && value.expiresAt <= filter.expiresBefore)),
      ),
    listCreditLotAllocations: (reservationId) =>
      all(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_credit_lot_allocations')}
         ${reservationId ? 'WHERE reservation_id = $1' : ''} ORDER BY created_at, id`,
        reservationId ? [reservationId] : [],
      ),
    getGrantPolicyApplication: (id) =>
      one(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_grant_policy_applications')} WHERE id = $1`,
        [id],
      ),
    getGrantPolicyApplicationByIdentity: (policyId, accountId, periodKey) =>
      one(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_grant_policy_applications')}
         WHERE policy_id = $1 AND account_id = $2 AND period_key = $3`,
        [policyId, accountId, periodKey],
      ),
    listGrantPolicyApplications: (filter = {}) =>
      filteredAll(
        db,
        `SELECT payload::text AS payload FROM ${t('resvary_grant_policy_applications')}
         ORDER BY created_at, id`,
        [],
        (value: GrantPolicyApplication) =>
          matchesBalanceFilter(value, filter) &&
          (!filter.policyId || value.policyId === filter.policyId) &&
          (!filter.policyType || value.policyType === filter.policyType) &&
          (!filter.periodKey || value.periodKey === filter.periodKey),
      ),
  };
}

function outboxSelect(tableName: string, suffix: string): string {
  return `SELECT payload::text AS payload, status, attempt_count,
    next_attempt_at::text, lease_owner, lease_expires_at::text,
    last_attempt_at::text, last_error, delivered_at::text FROM ${tableName} ${suffix}`;
}

function parseOutboxRow(row: OutboxRow): CreditOutboxEvent {
  const event = parseReceiptStoreValue<CreditOutboxEvent>(row.payload);
  return {
    ...event,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: Number(row.next_attempt_at),
    leaseOwner: row.lease_owner ?? undefined,
    leaseExpiresAt: row.lease_expires_at ? Number(row.lease_expires_at) : undefined,
    lastAttemptAt: row.last_attempt_at ? Number(row.last_attempt_at) : undefined,
    lastError: row.last_error ?? undefined,
    deliveredAt: row.delivered_at ? Number(row.delivered_at) : undefined,
  };
}

async function one<T>(db: Queryable, sql: string, values: unknown[] = []): Promise<T | undefined> {
  const result = await db.query<PayloadRow>(sql, values);
  return result.rows[0] ? parseReceiptStoreValue<T>(result.rows[0].payload) : undefined;
}

async function all<T>(db: Queryable, sql: string, values: unknown[] = []): Promise<T[]> {
  const result = await db.query<PayloadRow>(sql, values);
  return result.rows.map((row) => parseReceiptStoreValue<T>(row.payload));
}

async function filteredAll<T>(
  db: Queryable,
  sql: string,
  values: unknown[],
  filter: (value: T) => boolean,
): Promise<T[]> {
  return (await all<T>(db, sql, values)).filter(filter);
}

async function insert(
  db: Queryable,
  handle: PostgresHandle,
  name: string,
  columns: string[],
  values: unknown[],
  payload: unknown,
  conflictColumns: string[] = ['id'],
): Promise<void> {
  const allColumns = [...columns, 'payload'];
  const params = allColumns.map((_, index) => `$${index + 1}`).join(', ');
  await db.query(
    `INSERT INTO ${table(handle, name)} (${allColumns.join(', ')}) VALUES (${params})
     ON CONFLICT (${conflictColumns.join(', ')}) DO NOTHING`,
    [...values, serializeReceiptStoreValue(payload)],
  );
}

async function upsert(
  db: Queryable,
  handle: PostgresHandle,
  name: string,
  columns: string[],
  values: unknown[],
  payload: unknown,
): Promise<void> {
  const allColumns = [...columns, 'payload'];
  const params = allColumns.map((_, index) => `$${index + 1}`).join(', ');
  const updates = allColumns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = EXCLUDED.${column}`)
    .join(', ');
  await db.query(
    `INSERT INTO ${table(handle, name)} (${allColumns.join(', ')}) VALUES (${params})
     ON CONFLICT (id) DO UPDATE SET ${updates}`,
    [...values, serializeReceiptStoreValue(payload)],
  );
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

export function createPostgresCreditStore(config: PostgresCreditStoreConfig): PostgresCreditStore {
  return new PostgresCreditStore(config);
}
