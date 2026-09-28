import type { CreditStore } from '../credits/store.js';
import type {
  MeteredOperation,
  MeteredOperationStatus,
  CreditReservation,
} from '../credits/types.js';
import { rateUsage } from '../pricing/rating.js';
import { normalizeAdminPage, type AdminPage, type AdminPageInput } from './types.js';

export const METERED_OPERATION_STATUSES: readonly MeteredOperationStatus[] = [
  'queued',
  'running',
  'outcome_unknown',
  'result_saved',
  'needs_reconciliation',
  'settled',
  'cancelled',
];

/** An explicit allowlist: execution credentials and provider content never reach admin views. */
export type AdminMeteredOperation = Pick<
  MeteredOperation,
  | 'id'
  | 'projectId'
  | 'operationKey'
  | 'customerId'
  | 'priceId'
  | 'reservationId'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'claimedAt'
  | 'resultSavedAt'
  | 'settlementReservationId'
  | 'reconciliationAttempt'
  | 'receiptId'
  | 'resultHash'
  | 'evidenceReference'
> & { hasSavedResult: boolean };

export interface AdminOperationQuery extends AdminPageInput {
  projectId: string;
  customerId?: string;
  status?: MeteredOperationStatus;
  search?: string;
  updatedBefore?: number;
}

export interface OperationHealth {
  unresolvedCount: number;
  oldestUnresolvedAgeMs: number;
  byStatus: Record<MeteredOperationStatus, { count: number; oldestAgeMs: number }>;
}

export interface OperationTransition {
  id: string;
  createdAt: number;
  operationId: string;
  operationKey: string;
  fromStatus: MeteredOperationStatus | null;
  toStatus: MeteredOperationStatus;
  reconciliationAttempt: number;
  sequence: number;
}

/** Optional admin capability; existing custom AdminQueryStore implementations stay valid. */
export interface AdminOperationStore {
  listOperations(input: AdminOperationQuery): Promise<AdminPage<AdminMeteredOperation>>;
  getOperation(projectId: string, operationId: string): Promise<AdminMeteredOperation | undefined>;
  getOperationHealth(projectId: string, now?: number): Promise<OperationHealth>;
  listOperationHistory(
    projectId: string,
    operationId: string,
    input?: AdminPageInput,
  ): Promise<AdminPage<OperationTransition>>;
}

export function summarizeOperation(operation: MeteredOperation): AdminMeteredOperation {
  return {
    id: operation.id,
    projectId: operation.projectId,
    operationKey: operation.operationKey,
    customerId: operation.customerId,
    priceId: operation.priceId,
    reservationId: operation.reservationId,
    status: operation.status,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    claimedAt: operation.claimedAt,
    resultSavedAt: operation.resultSavedAt,
    settlementReservationId: operation.settlementReservationId,
    reconciliationAttempt: operation.reconciliationAttempt,
    receiptId: operation.receiptId,
    resultHash: operation.resultHash,
    evidenceReference: operation.evidenceReference,
    hasSavedResult: Boolean(operation.savedResult),
  };
}

export function normalizeOperationQuery(input: AdminOperationQuery) {
  if (input.status && !METERED_OPERATION_STATUSES.includes(input.status))
    throw new Error('Invalid operation status');
  if (input.updatedBefore !== undefined && !Number.isSafeInteger(input.updatedBefore))
    throw new Error('Invalid operation age cutoff');
  if (input.search && input.search.length > 200)
    throw new Error('Operation search is limited to 200 characters');
  return normalizeAdminPage(input);
}

export function operationHealth(
  rows: Array<{ status: string; count: number | string; oldest: number | string }>,
  now: number,
): OperationHealth {
  const byStatus = Object.fromEntries(
    METERED_OPERATION_STATUSES.map((status) => [status, { count: 0, oldestAgeMs: 0 }]),
  ) as OperationHealth['byStatus'];
  for (const row of rows) {
    if (METERED_OPERATION_STATUSES.includes(row.status as MeteredOperationStatus)) {
      byStatus[row.status as MeteredOperationStatus] = {
        count: Number(row.count),
        oldestAgeMs: Math.max(0, now - Number(row.oldest)),
      };
    }
  }
  const unresolved = [
    byStatus.outcome_unknown,
    byStatus.result_saved,
    byStatus.needs_reconciliation,
  ];
  return {
    byStatus,
    unresolvedCount: unresolved.reduce((sum, item) => sum + item.count, 0),
    oldestUnresolvedAgeMs: Math.max(...unresolved.map((item) => item.oldestAgeMs)),
  };
}

export function summarizeTransition(event: {
  id: string;
  createdAt: number;
  data: unknown;
}): OperationTransition {
  const data = event.data as OperationTransition;
  return {
    id: event.id,
    createdAt: event.createdAt,
    operationId: data.operationId,
    operationKey: data.operationKey,
    fromStatus: data.fromStatus,
    toStatus: data.toStatus,
    reconciliationAttempt: data.reconciliationAttempt,
    sequence: data.sequence,
  };
}

function reservationEvidence(reservation: CreditReservation | undefined) {
  return (
    reservation && {
      id: reservation.id,
      status: reservation.status,
      expiresAt: reservation.expiresAt,
      reservedUnits: reservation.reservedUnits,
      committedUnits: reservation.committedUnits,
      releasedUnits: reservation.releasedUnits,
    }
  );
}

export async function getOperationEvidence(
  store: CreditStore,
  projectId: string,
  operationKey: string,
) {
  const operation = await store.getMeteredOperation?.(projectId, operationKey);
  if (!operation || operation.projectId !== projectId) return undefined;
  const [original, settlement, price, account] = await Promise.all([
    store.getReservation(operation.reservationId),
    operation.settlementReservationId
      ? store.getReservation(operation.settlementReservationId)
      : undefined,
    store.getPriceVersion(operation.priceId),
    store.getAccountByCustomer(projectId, operation.customerId),
  ]);
  if (
    original?.projectId !== projectId ||
    (settlement && settlement.projectId !== projectId) ||
    price?.projectId !== projectId
  )
    throw new Error('Operation evidence is inconsistent');
  const rating = operation.savedResult
    ? rateUsage(price, operation.savedResult.actualUsage)
    : undefined;
  return {
    operation: summarizeOperation(operation),
    reservation: reservationEvidence(original),
    settlementReservation: reservationEvidence(settlement),
    availableUnits: account?.availableUnits ?? '0',
    usageEventId: operation.savedResult?.usageEventId,
    actualUsage: operation.savedResult?.actualUsage,
    amountUnits: rating?.totalUnits,
    lineItems: rating?.lineItems,
  };
}
