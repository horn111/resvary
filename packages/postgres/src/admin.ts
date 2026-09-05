import {
  encodeAdminCursor,
  normalizeAdminPage,
  type AdminAuditQuery,
  type AdminCustomerDetail,
  type AdminCustomerQuery,
  type AdminCustomerSummary,
  type AdminOverview,
  type AdminPage,
  type AdminPageInput,
  type AdminQueryStore,
  type AdminUsageEvidence,
  type AuditItem,
  type OperatorAction,
} from '@resvary/sdk/admin';
import type {
  CreditAccount,
  CreditGrant,
  CreditLot,
  CreditOutboxEvent,
  CreditReservation,
  FundingIntent,
  FundingTransaction,
  LedgerEntry,
  PriceVersion,
  UsageReceipt,
} from '@resvary/sdk/credits';
import { isDeepStrictEqual } from 'node:util';
import { parseReceiptStoreValue, serializeReceiptStoreValue } from '@resvary/sdk/receipts';
import {
  createPostgresHandle,
  table,
  type PostgresConnectionConfig,
  type PostgresHandle,
} from './connection.js';

type PayloadRow = { payload: string };
type AuditRow = {
  id: string;
  project_id: string;
  customer_id: string | null;
  kind: AuditItem['kind'];
  type: string;
  status: string | null;
  amount_units: string | null;
  created_at: string;
  payload: string;
};

export interface PostgresAdminStoreConfig extends PostgresConnectionConfig {}

export class PostgresAdminStore implements AdminQueryStore {
  private readonly handle: PostgresHandle;

  constructor(config: PostgresAdminStoreConfig) {
    this.handle = createPostgresHandle(config);
  }

  async getOverview(projectId: string, now = Date.now()): Promise<AdminOverview> {
    const accounts = table(this.handle, 'resvary_credit_accounts');
    const receipts = table(this.handle, 'resvary_usage_receipts');
    const reservations = table(this.handle, 'resvary_credit_reservations');
    const outbox = table(this.handle, 'resvary_outbox_events');
    const funding = table(this.handle, 'resvary_funding_transactions');
    const since30d = now - 30 * 86_400_000;
    const [balanceResult, receiptResult, reservationResult, outboxResult, fundingResult] =
      await Promise.all([
        this.handle.pool.query<{
          posted_units: string;
          reserved_units: string;
          customer_count: string;
        }>(
          `SELECT COALESCE(SUM(posted_units), 0)::text AS posted_units,
             COALESCE(SUM(reserved_units), 0)::text AS reserved_units,
             COUNT(*)::text AS customer_count
           FROM ${accounts} WHERE project_id = $1`,
          [projectId],
        ),
        this.handle.pool.query<{ charged_units: string; created_at: string }>(
          `SELECT charged_units::text, created_at::text FROM ${receipts}
           WHERE project_id = $1 AND created_at >= $2`,
          [projectId, since30d],
        ),
        this.handle.pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM ${reservations}
           WHERE project_id = $1 AND status = 'open' AND expires_at <= $2`,
          [projectId, now],
        ),
        this.handle.pool.query<{ status: string; count: string }>(
          `SELECT status, COUNT(*)::text AS count FROM ${outbox}
           WHERE project_id = $1 AND status IN ('pending', 'dead_letter') GROUP BY status`,
          [projectId],
        ),
        this.handle.pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM ${funding}
           WHERE project_id = $1 AND settlement_status = 'reconciliation_required'`,
          [projectId],
        ),
      ]);

    const balance = balanceResult.rows[0] ?? {
      posted_units: '0',
      reserved_units: '0',
      customer_count: '0',
    };
    const daily = createDailyBuckets(now, 30);
    let charged24h = 0n;
    let charged7d = 0n;
    let charged30d = 0n;
    for (const receipt of receiptResult.rows) {
      const units = BigInt(receipt.charged_units);
      const createdAt = Number(receipt.created_at);
      charged30d += units;
      if (createdAt >= now - 7 * 86_400_000) charged7d += units;
      if (createdAt >= now - 86_400_000) charged24h += units;
      const bucket = daily.get(utcDay(createdAt));
      if (bucket) {
        bucket.amountUnits = (BigInt(bucket.amountUnits) + units).toString();
        bucket.receiptCount += 1;
      }
    }
    const outboxCounts = new Map(outboxResult.rows.map((row) => [row.status, Number(row.count)]));
    return {
      projectId,
      generatedAt: now,
      postedUnits: balance.posted_units,
      reservedUnits: balance.reserved_units,
      availableUnits: (BigInt(balance.posted_units) - BigInt(balance.reserved_units)).toString(),
      charged24hUnits: charged24h.toString(),
      charged7dUnits: charged7d.toString(),
      charged30dUnits: charged30d.toString(),
      customerCount: Number(balance.customer_count),
      overdueReservationCount: Number(reservationResult.rows[0]?.count ?? 0),
      pendingOutboxCount: outboxCounts.get('pending') ?? 0,
      deadLetterCount: outboxCounts.get('dead_letter') ?? 0,
      reconciliationRequiredCount: Number(fundingResult.rows[0]?.count ?? 0),
      dailyCharges: [...daily.values()],
    };
  }

  async listCustomers(input: AdminCustomerQuery): Promise<AdminPage<AdminCustomerSummary>> {
    const page = normalizeAdminPage(input);
    const accounts = table(this.handle, 'resvary_credit_accounts');
    const receipts = table(this.handle, 'resvary_usage_receipts');
    const reservations = table(this.handle, 'resvary_credit_reservations');
    const ledger = table(this.handle, 'resvary_ledger_entries');
    const values: unknown[] = [input.projectId];
    const clauses = ['account.project_id = $1'];
    if (input.search?.trim()) {
      values.push(`%${escapeLike(input.search.trim())}%`);
      clauses.push(`account.customer_id ILIKE $${values.length} ESCAPE '\\'`);
    }
    if (page.cursor) {
      values.push(page.cursor.createdAt, page.cursor.id);
      clauses.push(
        `(account.updated_at < $${values.length - 1} OR (account.updated_at = $${values.length - 1} AND account.id < $${values.length}))`,
      );
    }
    values.push(Date.now() - 30 * 86_400_000, page.limit + 1);
    const sinceIndex = values.length - 1;
    const limitIndex = values.length;
    const result = await this.handle.pool.query<{
      id: string;
      updated_at: string;
      payload: string;
      receipt_count: string;
      charged_30d_units: string;
      open_reservation_count: string;
      last_activity_at: string | null;
    }>(
      `SELECT account.id, account.updated_at::text,
         account.payload::text AS payload,
         (SELECT COUNT(*)::text FROM ${receipts} receipt
           WHERE receipt.account_id = account.id) AS receipt_count,
         (SELECT COALESCE(SUM(receipt.charged_units), 0)::text FROM ${receipts} receipt
           WHERE receipt.account_id = account.id AND receipt.created_at >= $${sinceIndex}) AS charged_30d_units,
         (SELECT COUNT(*)::text FROM ${reservations} reservation
           WHERE reservation.account_id = account.id AND reservation.status = 'open') AS open_reservation_count,
         (SELECT entry.created_at::text FROM ${ledger} entry
           WHERE entry.account_id = account.id
           ORDER BY entry.created_at DESC, entry.id DESC LIMIT 1) AS last_activity_at
       FROM ${accounts} account
       WHERE ${clauses.join(' AND ')}
       ORDER BY account.updated_at DESC, account.id DESC LIMIT $${limitIndex}`,
      values,
    );
    const visible = result.rows.slice(0, page.limit);
    const items = visible.map(
      (row): AdminCustomerSummary => ({
        account: parseReceiptStoreValue<CreditAccount>(row.payload),
        receiptCount: Number(row.receipt_count),
        charged30dUnits: row.charged_30d_units,
        openReservationCount: Number(row.open_reservation_count),
        lastActivityAt: row.last_activity_at
          ? Number(row.last_activity_at)
          : Number(row.updated_at),
      }),
    );
    const last = visible.at(-1);
    return {
      items,
      nextCursor:
        result.rows.length > page.limit && last
          ? encodeAdminCursor({ createdAt: Number(last.updated_at), id: last.id })
          : undefined,
    };
  }

  async getCustomer(
    projectId: string,
    customerId: string,
  ): Promise<AdminCustomerDetail | undefined> {
    const account = await this.payload<CreditAccount>(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_credit_accounts')}
       WHERE project_id = $1 AND customer_id = $2`,
      [projectId, customerId],
    );
    if (!account) return undefined;
    const [grants, lots, reservations, receipts, entries, intents, transactions] =
      await Promise.all([
        this.payloads<CreditGrant>(
          `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_credit_grants')}
           WHERE account_id = $1 ORDER BY created_at DESC`,
          [account.id],
        ),
        this.payloads<CreditLot>(
          `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_credit_lots')}
           WHERE account_id = $1 ORDER BY created_at DESC`,
          [account.id],
        ),
        this.payloads<CreditReservation>(
          `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_credit_reservations')}
           WHERE account_id = $1 ORDER BY created_at DESC`,
          [account.id],
        ),
        this.payloads<UsageReceipt>(
          `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_usage_receipts')}
           WHERE account_id = $1 ORDER BY created_at DESC`,
          [account.id],
        ),
        this.payloads<LedgerEntry>(
          `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_ledger_entries')}
           WHERE account_id = $1 ORDER BY created_at DESC`,
          [account.id],
        ),
        this.payloads<FundingIntent>(
          `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_funding_intents')}
           WHERE project_id = $1 AND customer_id = $2 ORDER BY created_at DESC`,
          [projectId, customerId],
        ),
        this.payloads<FundingTransaction>(
          `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_funding_transactions')}
           WHERE project_id = $1 AND customer_id = $2 ORDER BY created_at DESC`,
          [projectId, customerId],
        ),
      ]);
    return {
      account,
      grants,
      lots,
      reservations,
      receipts,
      ledgerEntries: entries,
      fundingIntents: intents,
      fundingTransactions: transactions,
    };
  }

  async listAuditItems(input: AdminAuditQuery): Promise<AdminPage<AuditItem>> {
    const page = normalizeAdminPage(input);
    const values: unknown[] = [input.projectId];
    const clauses = ['project_id = $1'];
    for (const [value, column] of [
      [input.customerId, 'customer_id'],
      [input.entityId, 'id'],
      [input.kind, 'kind'],
      [input.type, 'type'],
      [input.status, 'status'],
    ] as const) {
      if (value) {
        values.push(value);
        clauses.push(`${column} = $${values.length}`);
      }
    }
    if (input.from !== undefined) {
      values.push(input.from);
      clauses.push(`created_at >= $${values.length}`);
    }
    if (input.to !== undefined) {
      values.push(input.to);
      clauses.push(`created_at <= $${values.length}`);
    }
    if (page.cursor) {
      values.push(page.cursor.createdAt, page.cursor.id);
      clauses.push(
        `(created_at < $${values.length - 1} OR (created_at = $${values.length - 1} AND id < $${values.length}))`,
      );
    }
    values.push(page.limit + 1);
    const result = await this.handle.pool.query<AuditRow>(
      `SELECT id, project_id, customer_id, kind, type, status, amount_units,
          created_at::text, payload::text AS payload
       FROM (${auditUnionSql(this.handle)}) activity
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
      values,
    );
    const visible = result.rows.slice(0, page.limit);
    const last = visible.at(-1);
    return {
      items: visible.map(toAuditItem),
      nextCursor:
        result.rows.length > page.limit && last
          ? encodeAdminCursor({ createdAt: Number(last.created_at), id: last.id })
          : undefined,
    };
  }

  async getUsageEvidence(
    projectId: string,
    receiptId: string,
  ): Promise<AdminUsageEvidence | undefined> {
    const receipt = await this.payload<UsageReceipt>(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_usage_receipts')}
       WHERE project_id = $1 AND id = $2`,
      [projectId, receiptId],
    );
    if (!receipt) return undefined;
    const [reservation, price, entries] = await Promise.all([
      this.payload<CreditReservation>(
        `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_credit_reservations')}
         WHERE project_id = $1 AND id = $2`,
        [projectId, receipt.reservationId],
      ),
      this.payload<PriceVersion>(
        `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_price_versions')}
         WHERE id = $1`,
        [receipt.priceId],
      ),
      this.payloads<LedgerEntry>(
        `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_ledger_entries')}
         WHERE project_id = $1 AND account_id = $2`,
        [projectId, receipt.accountId],
      ),
    ]);
    return {
      receipt,
      reservation,
      price,
      ledgerEntries: entries.filter(
        (entry) =>
          entry.referenceId === receipt.id ||
          entry.referenceId === receipt.reservationId ||
          entry.metadata?.reservationId === receipt.reservationId,
      ),
    };
  }

  listOverdueReservations(projectId: string, now = Date.now()) {
    return this.payloads<CreditReservation>(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_credit_reservations')}
       WHERE project_id = $1 AND status = 'open' AND expires_at <= $2
       ORDER BY expires_at ASC, id ASC LIMIT 100`,
      [projectId, now],
    );
  }

  listDeadLetterEvents(projectId: string) {
    return this.payloads<CreditOutboxEvent>(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_outbox_events')}
       WHERE project_id = $1 AND status = 'dead_letter'
       ORDER BY created_at DESC, id DESC LIMIT 100`,
      [projectId],
    );
  }

  getOperatorAction(projectId: string, id: string) {
    return this.payload<OperatorAction>(
      `SELECT payload::text AS payload FROM ${table(this.handle, 'resvary_operator_actions')}
       WHERE project_id = $1 AND id = $2 ORDER BY sequence DESC LIMIT 1`,
      [projectId, id],
    );
  }

  async listOperatorActions(projectId: string, input: AdminPageInput = {}) {
    const page = normalizeAdminPage(input);
    const actions = table(this.handle, 'resvary_operator_actions');
    const values: unknown[] = [projectId];
    const clauses = ['action.project_id = $1'];
    if (page.cursor) {
      values.push(page.cursor.createdAt, page.cursor.id);
      clauses.push(`(action.created_at < $2 OR (action.created_at = $2 AND action.id < $3))`);
    }
    values.push(page.limit + 1);
    const result = await this.handle.pool.query<{
      id: string;
      created_at: string;
      payload: string;
    }>(
      `SELECT action.id, action.created_at::text, action.payload::text AS payload
       FROM ${actions} action
       JOIN (
         SELECT id, MAX(sequence) AS sequence FROM ${actions}
         WHERE project_id = $1 GROUP BY id
       ) latest ON latest.id = action.id AND latest.sequence = action.sequence
       WHERE ${clauses.join(' AND ')}
       ORDER BY action.created_at DESC, action.id DESC LIMIT $${values.length}`,
      values,
    );
    const visible = result.rows.slice(0, page.limit);
    const last = visible.at(-1);
    return {
      items: visible.map((row) => parseReceiptStoreValue<OperatorAction>(row.payload)),
      nextCursor:
        result.rows.length > page.limit && last
          ? encodeAdminCursor({ createdAt: Number(last.created_at), id: last.id })
          : undefined,
    };
  }

  async appendOperatorAction(action: OperatorAction): Promise<void> {
    const actions = table(this.handle, 'resvary_operator_actions');
    const payload = serializeReceiptStoreValue(action);
    const result = await this.handle.pool.query<{ payload: string }>(
      `INSERT INTO ${actions}
        (id, sequence, project_id, action_type, target_type, target_id, status, created_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (id, sequence) DO NOTHING RETURNING payload::text AS payload`,
      [
        action.id,
        action.sequence,
        action.projectId,
        action.type,
        action.targetType,
        action.targetId,
        action.status,
        action.completedAt ?? action.createdAt,
        payload,
      ],
    );
    if (result.rowCount === 1) return;
    const existing = await this.handle.pool.query<{ payload: string }>(
      `SELECT payload::text AS payload FROM ${actions} WHERE id = $1 AND sequence = $2`,
      [action.id, action.sequence],
    );
    const existingAction = existing.rows[0]
      ? parseReceiptStoreValue<OperatorAction>(existing.rows[0].payload)
      : undefined;
    if (!existingAction || !isDeepStrictEqual(existingAction, action)) {
      throw new Error(`Operator action ${action.id}:${action.sequence} already exists`);
    }
  }

  async close(): Promise<void> {
    if (this.handle.ownsPool) await this.handle.pool.end();
  }

  private async payload<T>(sql: string, values: unknown[]): Promise<T | undefined> {
    const result = await this.handle.pool.query<PayloadRow>(sql, values);
    return result.rows[0] ? parseReceiptStoreValue<T>(result.rows[0].payload) : undefined;
  }

  private async payloads<T>(sql: string, values: unknown[]): Promise<T[]> {
    const result = await this.handle.pool.query<PayloadRow>(sql, values);
    return result.rows.map((row) => parseReceiptStoreValue<T>(row.payload));
  }
}

export function createPostgresAdminStore(config: PostgresAdminStoreConfig): PostgresAdminStore {
  return new PostgresAdminStore(config);
}

function utcDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function createDailyBuckets(now: number, days: number) {
  const buckets = new Map<string, { day: string; amountUnits: string; receiptCount: number }>();
  const today = new Date(now);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = utcDay(start - offset * 86_400_000);
    buckets.set(day, { day, amountUnits: '0', receiptCount: 0 });
  }
  return buckets;
}

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function toAuditItem(row: AuditRow): AuditItem {
  return {
    id: row.id,
    projectId: row.project_id,
    customerId: row.customer_id ?? undefined,
    kind: row.kind,
    type: row.type,
    status: row.status ?? undefined,
    amountUnits: row.amount_units ?? undefined,
    createdAt: Number(row.created_at),
    payload: parseReceiptStoreValue<unknown>(row.payload),
  };
}

function auditUnionSql(handle: PostgresHandle): string {
  const t = (name: string) => table(handle, name);
  return `
    SELECT id, project_id, customer_id, 'grant'::text AS kind, source AS type,
      NULL::text AS status, amount_units::text, created_at, payload FROM ${t('resvary_credit_grants')}
    UNION ALL
    SELECT id, project_id, customer_id, 'reservation', 'credit.reservation',
      status, reserved_units::text, created_at, payload FROM ${t('resvary_credit_reservations')}
    UNION ALL
    SELECT id, project_id, customer_id, 'usage_receipt', 'usage.charged',
      'committed', charged_units::text, created_at, payload FROM ${t('resvary_usage_receipts')}
    UNION ALL
    SELECT id, project_id, customer_id, 'ledger_entry', entry_type,
      NULL, delta_units::text, created_at, payload FROM ${t('resvary_ledger_entries')}
    UNION ALL
    SELECT id, project_id, customer_id, 'funding_intent', 'funding.intent',
      status, requested_units::text, created_at, payload FROM ${t('resvary_funding_intents')}
    UNION ALL
    SELECT id, project_id, customer_id, 'funding_transaction', 'funding.transaction',
      settlement_status, amount_units::text, created_at, payload FROM ${t('resvary_funding_transactions')}
    UNION ALL
    SELECT id, project_id, NULL, 'outbox_event', type,
      status, NULL, created_at, payload FROM ${t('resvary_outbox_events')}
    UNION ALL
    SELECT action.id, action.project_id,
      CASE WHEN action.target_type = 'customer' THEN action.target_id ELSE NULL END,
      'operator_action', action.action_type, action.status, NULL, action.created_at, action.payload
      FROM ${t('resvary_operator_actions')} action
      JOIN (
        SELECT id, MAX(sequence) AS sequence FROM ${t('resvary_operator_actions')} GROUP BY id
      ) latest ON latest.id = action.id AND latest.sequence = action.sequence
  `;
}
