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
} from '../credits/types.js';

export interface AdminPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface AdminPageInput {
  cursor?: string;
  limit?: number;
}

export interface AdminOverview {
  projectId: string;
  generatedAt: number;
  postedUnits: string;
  reservedUnits: string;
  availableUnits: string;
  charged24hUnits: string;
  charged7dUnits: string;
  charged30dUnits: string;
  customerCount: number;
  overdueReservationCount: number;
  pendingOutboxCount: number;
  deadLetterCount: number;
  reconciliationRequiredCount: number;
  dailyCharges: Array<{ day: string; amountUnits: string; receiptCount: number }>;
}

export interface AdminCustomerSummary {
  account: CreditAccount;
  receiptCount: number;
  charged30dUnits: string;
  openReservationCount: number;
  lastActivityAt?: number;
}

export interface AdminCustomerQuery extends AdminPageInput {
  projectId: string;
  search?: string;
}

export type AuditItemKind =
  | 'grant'
  | 'reservation'
  | 'usage_receipt'
  | 'ledger_entry'
  | 'funding_intent'
  | 'funding_transaction'
  | 'outbox_event'
  | 'operator_action';

export interface AuditItem {
  id: string;
  projectId: string;
  customerId?: string;
  kind: AuditItemKind;
  type: string;
  status?: string;
  amountUnits?: string;
  createdAt: number;
  payload: unknown;
}

export interface AdminAuditQuery extends AdminPageInput {
  projectId: string;
  customerId?: string;
  entityId?: string;
  kind?: AuditItemKind;
  type?: string;
  status?: string;
  from?: number;
  to?: number;
}

export interface AdminCustomerDetail {
  account: CreditAccount;
  grants: CreditGrant[];
  lots: CreditLot[];
  reservations: CreditReservation[];
  receipts: UsageReceipt[];
  ledgerEntries: LedgerEntry[];
  fundingIntents: FundingIntent[];
  fundingTransactions: FundingTransaction[];
}

export interface AdminUsageEvidence {
  receipt: UsageReceipt;
  reservation?: CreditReservation;
  price?: PriceVersion;
  ledgerEntries: LedgerEntry[];
}

export type OperatorActionType =
  | 'credit.grant'
  | 'credit.adjust'
  | 'reservation.expire_overdue'
  | 'outbox.requeue';

export type OperatorActionStatus = 'pending' | 'succeeded' | 'failed';

export interface OperatorAction {
  id: string;
  sequence: number;
  projectId: string;
  type: OperatorActionType;
  targetType: 'customer' | 'project' | 'outbox_event';
  targetId: string;
  reason: string;
  status: OperatorActionStatus;
  createdAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

export interface AdminQueryStore {
  getOverview(projectId: string, now?: number): Promise<AdminOverview>;
  listCustomers(input: AdminCustomerQuery): Promise<AdminPage<AdminCustomerSummary>>;
  getCustomer(projectId: string, customerId: string): Promise<AdminCustomerDetail | undefined>;
  listAuditItems(input: AdminAuditQuery): Promise<AdminPage<AuditItem>>;
  getUsageEvidence(projectId: string, receiptId: string): Promise<AdminUsageEvidence | undefined>;
  listOverdueReservations(projectId: string, now?: number): Promise<CreditReservation[]>;
  listDeadLetterEvents(projectId: string): Promise<CreditOutboxEvent[]>;
  getOperatorAction(projectId: string, id: string): Promise<OperatorAction | undefined>;
  listOperatorActions(
    projectId: string,
    input?: AdminPageInput,
  ): Promise<AdminPage<OperatorAction>>;
  appendOperatorAction(action: OperatorAction): Promise<void>;
}

export interface AdminCursorValue {
  createdAt: number;
  id: string;
}

export function normalizeAdminPage(input: AdminPageInput): {
  limit: number;
  cursor?: AdminCursorValue;
} {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error('Admin page limit must be an integer between 1 and 100');
  }
  return { limit, cursor: input.cursor ? decodeAdminCursor(input.cursor) : undefined };
}

export function encodeAdminCursor(value: AdminCursorValue): string {
  const encoded = JSON.stringify(value);
  return Buffer.from(encoded, 'utf8').toString('base64url');
}

export function decodeAdminCursor(value: string): AdminCursorValue {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Partial<AdminCursorValue>;
    const createdAt = parsed.createdAt;
    if (!Number.isSafeInteger(createdAt) || typeof parsed.id !== 'string' || !parsed.id) {
      throw new Error('invalid cursor payload');
    }
    return { createdAt: createdAt as number, id: parsed.id };
  } catch {
    throw new Error('Invalid admin cursor');
  }
}
