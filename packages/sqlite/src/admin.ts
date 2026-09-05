import { DatabaseSync, type DatabaseSync as DatabaseSyncType } from 'node:sqlite';
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
import { parseReceiptStoreValue, serializeReceiptStoreValue } from '@resvary/sdk/receipts';
import { SqliteCreditStore, type SqliteCreditStoreConfig } from './credit.js';

type PayloadRow = { payload: string };
type AuditRow = {
  id: string;
  project_id: string;
  customer_id: string | null;
  kind: AuditItem['kind'];
  type: string;
  status: string | null;
  amount_units: string | null;
  created_at: number;
  payload: string;
};

export type SqliteAdminStoreConfig = SqliteCreditStoreConfig;

export class SqliteAdminStore implements AdminQueryStore {
  private readonly db: DatabaseSyncType;

  constructor(config: SqliteAdminStoreConfig) {
    const migrator = new SqliteCreditStore(config);
    migrator.close();
    this.db = new DatabaseSync(config.path, { readOnly: false });
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  }

  async getOverview(projectId: string, now = Date.now()): Promise<AdminOverview> {
    const accountRows = this.db
      .prepare(
        `SELECT posted_units, reserved_units FROM resvary_credit_accounts WHERE project_id = ?`,
      )
      .all(projectId) as Array<{ posted_units: string; reserved_units: string }>;
    const since30d = now - 30 * 86_400_000;
    const receipts = this.db
      .prepare(
        `SELECT charged_units, created_at FROM resvary_usage_receipts
         WHERE project_id = ? AND created_at >= ?`,
      )
      .all(projectId, since30d) as Array<{ charged_units: string; created_at: number }>;
    const outboxRows = this.db
      .prepare(
        `SELECT status, COUNT(*) AS count FROM resvary_outbox_events
         WHERE project_id = ? AND status IN ('pending', 'dead_letter') GROUP BY status`,
      )
      .all(projectId) as Array<{ status: string; count: number }>;
    const outbox = new Map(outboxRows.map((row) => [row.status, Number(row.count)]));
    const daily = createDailyBuckets(now, 30);
    let charged24h = 0n;
    let charged7d = 0n;
    let charged30d = 0n;
    for (const receipt of receipts) {
      const units = BigInt(receipt.charged_units);
      charged30d += units;
      if (receipt.created_at >= now - 7 * 86_400_000) charged7d += units;
      if (receipt.created_at >= now - 86_400_000) charged24h += units;
      const key = utcDay(receipt.created_at);
      const bucket = daily.get(key);
      if (bucket) {
        bucket.amountUnits = (BigInt(bucket.amountUnits) + units).toString();
        bucket.receiptCount += 1;
      }
    }

    return {
      projectId,
      generatedAt: now,
      postedUnits: sumUnits(accountRows.map((row) => row.posted_units)),
      reservedUnits: sumUnits(accountRows.map((row) => row.reserved_units)),
      availableUnits: sumUnits(
        accountRows.map((row) =>
          (BigInt(row.posted_units) - BigInt(row.reserved_units)).toString(),
        ),
      ),
      charged24hUnits: charged24h.toString(),
      charged7dUnits: charged7d.toString(),
      charged30dUnits: charged30d.toString(),
      customerCount: accountRows.length,
      overdueReservationCount: count(
        this.db,
        `SELECT COUNT(*) AS count FROM resvary_credit_reservations
         WHERE project_id = ? AND status = 'open' AND expires_at <= ?`,
        [projectId, now],
      ),
      pendingOutboxCount: outbox.get('pending') ?? 0,
      deadLetterCount: outbox.get('dead_letter') ?? 0,
      reconciliationRequiredCount: count(
        this.db,
        `SELECT COUNT(*) AS count FROM resvary_funding_transactions
         WHERE project_id = ? AND settlement_status = 'reconciliation_required'`,
        [projectId],
      ),
      dailyCharges: [...daily.values()],
    };
  }

  async listCustomers(input: AdminCustomerQuery): Promise<AdminPage<AdminCustomerSummary>> {
    const page = normalizeAdminPage(input);
    const clauses = ['project_id = ?'];
    const values: unknown[] = [input.projectId];
    if (input.search?.trim()) {
      clauses.push(`customer_id LIKE ? ESCAPE '\\'`);
      values.push(`%${escapeLike(input.search.trim())}%`);
    }
    if (page.cursor) {
      clauses.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
      values.push(page.cursor.createdAt, page.cursor.createdAt, page.cursor.id);
    }
    values.push(page.limit + 1);
    const rows = this.db
      .prepare(
        `SELECT id, customer_id, updated_at, payload FROM resvary_credit_accounts
         WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(...values) as Array<{
      id: string;
      customer_id: string;
      updated_at: number;
      payload: string;
    }>;
    const visible = rows.slice(0, page.limit);
    const items = visible.map((row) => {
      const receipts = this.db
        .prepare(
          `SELECT charged_units, created_at FROM resvary_usage_receipts
           WHERE account_id = ? AND created_at >= ? ORDER BY created_at DESC`,
        )
        .all(row.id, Date.now() - 30 * 86_400_000) as Array<{
        charged_units: string;
        created_at: number;
      }>;
      const lastLedger = this.db
        .prepare(
          `SELECT created_at FROM resvary_ledger_entries
           WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .get(row.id) as { created_at: number } | undefined;
      return {
        account: parseReceiptStoreValue<CreditAccount>(row.payload),
        receiptCount: count(
          this.db,
          `SELECT COUNT(*) AS count FROM resvary_usage_receipts WHERE account_id = ?`,
          [row.id],
        ),
        charged30dUnits: sumUnits(receipts.map((receipt) => receipt.charged_units)),
        openReservationCount: count(
          this.db,
          `SELECT COUNT(*) AS count FROM resvary_credit_reservations
           WHERE account_id = ? AND status = 'open'`,
          [row.id],
        ),
        lastActivityAt: lastLedger?.created_at ?? row.updated_at,
      } satisfies AdminCustomerSummary;
    });
    const last = visible.at(-1);
    return {
      items,
      nextCursor:
        rows.length > page.limit && last
          ? encodeAdminCursor({ createdAt: last.updated_at, id: last.id })
          : undefined,
    };
  }

  async getCustomer(
    projectId: string,
    customerId: string,
  ): Promise<AdminCustomerDetail | undefined> {
    const accountRow = this.db
      .prepare(
        `SELECT payload FROM resvary_credit_accounts WHERE project_id = ? AND customer_id = ?`,
      )
      .get(projectId, customerId) as PayloadRow | undefined;
    if (!accountRow) return undefined;
    const account = parseReceiptStoreValue<CreditAccount>(accountRow.payload);
    return {
      account,
      grants: this.payloads<CreditGrant>(
        `SELECT payload FROM resvary_credit_grants WHERE account_id = ? ORDER BY created_at DESC`,
        account.id,
      ),
      lots: this.payloads<CreditLot>(
        `SELECT payload FROM resvary_credit_lots WHERE account_id = ? ORDER BY created_at DESC`,
        account.id,
      ),
      reservations: this.payloads<CreditReservation>(
        `SELECT payload FROM resvary_credit_reservations WHERE account_id = ? ORDER BY created_at DESC`,
        account.id,
      ),
      receipts: this.payloads<UsageReceipt>(
        `SELECT payload FROM resvary_usage_receipts WHERE account_id = ? ORDER BY created_at DESC`,
        account.id,
      ),
      ledgerEntries: this.payloads<LedgerEntry>(
        `SELECT payload FROM resvary_ledger_entries WHERE account_id = ? ORDER BY created_at DESC`,
        account.id,
      ),
      fundingIntents: this.payloads<FundingIntent>(
        `SELECT payload FROM resvary_funding_intents
         WHERE project_id = ? AND customer_id = ? ORDER BY created_at DESC`,
        projectId,
        customerId,
      ),
      fundingTransactions: this.payloads<FundingTransaction>(
        `SELECT payload FROM resvary_funding_transactions
         WHERE project_id = ? AND customer_id = ? ORDER BY created_at DESC`,
        projectId,
        customerId,
      ),
    };
  }

  async listAuditItems(input: AdminAuditQuery): Promise<AdminPage<AuditItem>> {
    const page = normalizeAdminPage(input);
    const rows = auditBranches
      .flatMap((branch) => queryAuditBranch(this.db, input, page, branch))
      .sort((left, right) => right.created_at - left.created_at || right.id.localeCompare(left.id))
      .slice(0, page.limit + 1);
    const visible = rows.slice(0, page.limit);
    const items = visible.map(toAuditItem);
    const last = visible.at(-1);
    return {
      items,
      nextCursor:
        rows.length > page.limit && last
          ? encodeAdminCursor({ createdAt: last.created_at, id: last.id })
          : undefined,
    };
  }

  async getUsageEvidence(
    projectId: string,
    receiptId: string,
  ): Promise<AdminUsageEvidence | undefined> {
    const row = this.db
      .prepare(`SELECT payload FROM resvary_usage_receipts WHERE project_id = ? AND id = ?`)
      .get(projectId, receiptId) as PayloadRow | undefined;
    if (!row) return undefined;
    const receipt = parseReceiptStoreValue<UsageReceipt>(row.payload);
    const reservation = this.payload<CreditReservation>(
      `SELECT payload FROM resvary_credit_reservations WHERE project_id = ? AND id = ?`,
      projectId,
      receipt.reservationId,
    );
    const price = this.payload<PriceVersion>(
      `SELECT payload FROM resvary_price_versions WHERE id = ?`,
      receipt.priceId,
    );
    const ledgerEntries = this.payloads<LedgerEntry>(
      `SELECT payload FROM resvary_ledger_entries WHERE project_id = ? AND account_id = ?`,
      projectId,
      receipt.accountId,
    ).filter(
      (entry) =>
        entry.referenceId === receipt.id ||
        entry.referenceId === receipt.reservationId ||
        entry.metadata?.reservationId === receipt.reservationId,
    );
    return { receipt, reservation, price, ledgerEntries };
  }

  async listOverdueReservations(projectId: string, now = Date.now()) {
    return this.payloads<CreditReservation>(
      `SELECT payload FROM resvary_credit_reservations
       WHERE project_id = ? AND status = 'open' AND expires_at <= ?
       ORDER BY expires_at ASC, id ASC LIMIT 100`,
      projectId,
      now,
    );
  }

  async listDeadLetterEvents(projectId: string) {
    return this.payloads<CreditOutboxEvent>(
      `SELECT payload FROM resvary_outbox_events
       WHERE project_id = ? AND status = 'dead_letter'
       ORDER BY created_at DESC, id DESC LIMIT 100`,
      projectId,
    );
  }

  async getOperatorAction(projectId: string, id: string) {
    return this.payload<OperatorAction>(
      `SELECT payload FROM resvary_operator_actions
       WHERE project_id = ? AND id = ? ORDER BY sequence DESC LIMIT 1`,
      projectId,
      id,
    );
  }

  async listOperatorActions(projectId: string, input: AdminPageInput = {}) {
    const page = normalizeAdminPage(input);
    const clauses = ['a.project_id = ?'];
    const values: unknown[] = [projectId];
    if (page.cursor) {
      clauses.push('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))');
      values.push(page.cursor.createdAt, page.cursor.createdAt, page.cursor.id);
    }
    values.push(page.limit + 1);
    const rows = this.db
      .prepare(
        `SELECT a.id, a.created_at, a.payload FROM resvary_operator_actions a
         JOIN (
           SELECT id, MAX(sequence) AS sequence FROM resvary_operator_actions
           WHERE project_id = ? GROUP BY id
         ) latest ON latest.id = a.id AND latest.sequence = a.sequence
         WHERE ${clauses.join(' AND ')}
         ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      )
      .all(projectId, ...values) as Array<{ id: string; created_at: number; payload: string }>;
    const visible = rows.slice(0, page.limit);
    const last = visible.at(-1);
    return {
      items: visible.map((row) => parseReceiptStoreValue<OperatorAction>(row.payload)),
      nextCursor:
        rows.length > page.limit && last
          ? encodeAdminCursor({ createdAt: last.created_at, id: last.id })
          : undefined,
    };
  }

  async appendOperatorAction(action: OperatorAction): Promise<void> {
    const existing = this.db
      .prepare(`SELECT payload FROM resvary_operator_actions WHERE id = ? AND sequence = ?`)
      .get(action.id, action.sequence) as PayloadRow | undefined;
    const payload = serializeReceiptStoreValue(action);
    if (existing) {
      if (existing.payload !== payload) {
        throw new Error(`Operator action ${action.id}:${action.sequence} already exists`);
      }
      return;
    }
    this.db
      .prepare(
        `INSERT INTO resvary_operator_actions
         (id, sequence, project_id, action_type, target_type, target_id, status, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        action.id,
        action.sequence,
        action.projectId,
        action.type,
        action.targetType,
        action.targetId,
        action.status,
        action.completedAt ?? action.createdAt,
        payload,
      );
  }

  close(): void {
    this.db.close();
  }

  private payload<T>(sql: string, ...values: unknown[]): T | undefined {
    const row = this.db.prepare(sql).get(...values) as PayloadRow | undefined;
    return row ? parseReceiptStoreValue<T>(row.payload) : undefined;
  }

  private payloads<T>(sql: string, ...values: unknown[]): T[] {
    return (this.db.prepare(sql).all(...values) as PayloadRow[]).map((row) =>
      parseReceiptStoreValue<T>(row.payload),
    );
  }
}

export function createSqliteAdminStore(config: SqliteAdminStoreConfig): SqliteAdminStore {
  return new SqliteAdminStore(config);
}

function count(db: DatabaseSyncType, sql: string, values: unknown[]): number {
  const row = db.prepare(sql).get(...values) as { count: number };
  return Number(row.count);
}

function sumUnits(values: string[]): string {
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
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
    createdAt: row.created_at,
    payload: parseReceiptStoreValue<unknown>(row.payload),
  };
}

type AuditBranch = {
  kind: AuditItem['kind'];
  from: string;
  id: string;
  project: string;
  customer: string;
  type: string;
  status: string;
  amount: string;
  createdAt: string;
  payload: string;
};

const auditBranches: AuditBranch[] = [
  branch('grant', 'resvary_credit_grants', 'source', 'NULL', 'amount_units'),
  branch(
    'reservation',
    'resvary_credit_reservations',
    "'credit.reservation'",
    'status',
    'reserved_units',
  ),
  branch(
    'usage_receipt',
    'resvary_usage_receipts',
    "'usage.charged'",
    "'committed'",
    'charged_units',
  ),
  branch('ledger_entry', 'resvary_ledger_entries', 'entry_type', 'NULL', 'delta_units'),
  branch(
    'funding_intent',
    'resvary_funding_intents',
    "'funding.intent'",
    'status',
    'requested_units',
  ),
  branch(
    'funding_transaction',
    'resvary_funding_transactions',
    "'funding.transaction'",
    'settlement_status',
    'amount_units',
  ),
  branch('outbox_event', 'resvary_outbox_events', 'type', 'status', 'NULL', 'NULL'),
  {
    kind: 'operator_action',
    from: `resvary_operator_actions a JOIN (
      SELECT id, MAX(sequence) AS sequence FROM resvary_operator_actions GROUP BY id
    ) latest ON latest.id = a.id AND latest.sequence = a.sequence`,
    id: 'a.id',
    project: 'a.project_id',
    customer: "CASE WHEN a.target_type = 'customer' THEN a.target_id ELSE NULL END",
    type: 'a.action_type',
    status: 'a.status',
    amount: 'NULL',
    createdAt: 'a.created_at',
    payload: 'a.payload',
  },
];

function branch(
  kind: AuditItem['kind'],
  from: string,
  type: string,
  status: string,
  amount: string,
  customer = 'customer_id',
): AuditBranch {
  return {
    kind,
    from,
    id: 'id',
    project: 'project_id',
    customer,
    type,
    status,
    amount,
    createdAt: 'created_at',
    payload: 'payload',
  };
}

function queryAuditBranch(
  db: DatabaseSyncType,
  input: AdminAuditQuery,
  page: ReturnType<typeof normalizeAdminPage>,
  source: AuditBranch,
): AuditRow[] {
  if (input.kind && input.kind !== source.kind) return [];
  const clauses = [`${source.project} = ?`];
  const values: unknown[] = [input.projectId];
  for (const [value, expression] of [
    [input.customerId, source.customer],
    [input.entityId, source.id],
    [input.type, source.type],
    [input.status, source.status],
  ] as const) {
    if (value) {
      clauses.push(`${expression} = ?`);
      values.push(value);
    }
  }
  if (input.from !== undefined) {
    clauses.push(`${source.createdAt} >= ?`);
    values.push(input.from);
  }
  if (input.to !== undefined) {
    clauses.push(`${source.createdAt} <= ?`);
    values.push(input.to);
  }
  if (page.cursor) {
    clauses.push(`(${source.createdAt} < ? OR (${source.createdAt} = ? AND ${source.id} < ?))`);
    values.push(page.cursor.createdAt, page.cursor.createdAt, page.cursor.id);
  }
  values.push(page.limit + 1);
  return db
    .prepare(
      `SELECT ${source.id} AS id, ${source.project} AS project_id,
         ${source.customer} AS customer_id, '${source.kind}' AS kind,
         ${source.type} AS type, ${source.status} AS status, ${source.amount} AS amount_units,
         ${source.createdAt} AS created_at, ${source.payload} AS payload
       FROM ${source.from}
       WHERE ${clauses.join(' AND ')}
       ORDER BY ${source.createdAt} DESC, ${source.id} DESC LIMIT ?`,
    )
    .all(...values) as AuditRow[];
}
