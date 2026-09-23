import { createHash, randomBytes } from 'node:crypto';
import {
  CreditNotFoundError,
  IdempotencyConflictError,
  InvalidCreditStateError,
  UnsupportedCreditStoreCapabilityError,
} from './errors.js';
import { CreditLedger, type RunMeteredInput } from './ledger.js';
import type { CreditStoreTransaction, MeteredOperationFilter } from './store.js';
import type { MeteredOperation, MeteredProviderResult, UsageReceipt } from './types.js';

const MAX_RESULT_BYTES = 128 * 1024;

type OperationTransaction = CreditStoreTransaction & {
  getMeteredOperation(
    projectId: string,
    operationKey: string,
  ): Promise<MeteredOperation | undefined>;
  saveMeteredOperation(operation: MeteredOperation): Promise<void>;
};

export interface SaveMeteredResultInput {
  operationKey: string;
  claimToken: string;
  result: MeteredProviderResult;
}

export interface RecoverMeteredResultInput {
  operationKey: string;
  evidenceReference: string;
  result: MeteredProviderResult;
}

/** Coordinates durable provider execution separately from the reservation lifecycle. */
export class DurableMeteredOperations {
  private readonly now: () => number;

  constructor(
    readonly ledger: CreditLedger,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.requireStore();
  }

  async create(input: RunMeteredInput): Promise<MeteredOperation> {
    await this.transaction(async () => undefined);
    const operationKey = requireText(input.idempotencyKey, 'idempotencyKey');
    const requestHash = hash(input);
    const existing = await this.get(operationKey);
    if (existing) return sameRequest(existing, requestHash);

    const id = operationId(this.ledger.projectId, operationKey);
    const reservation = await this.ledger.reserveCredits({
      ...input,
      idempotencyKey: `${id}:reserve`,
    });
    return this.transaction(async (tx) => {
      const concurrent = await tx.getMeteredOperation(this.ledger.projectId, operationKey);
      if (concurrent) return sameRequest(concurrent, requestHash);
      const now = this.now();
      const operation: MeteredOperation = {
        id,
        projectId: this.ledger.projectId,
        operationKey,
        customerId: reservation.customerId,
        priceId: reservation.priceId,
        reservationId: reservation.id,
        requestHash,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      };
      await tx.saveMeteredOperation(operation);
      return operation;
    });
  }

  get(operationKey: string): Promise<MeteredOperation | undefined> {
    return this.requireStore().getMeteredOperation!(
      this.ledger.projectId,
      requireText(operationKey, 'operationKey'),
    );
  }

  list(filter: Omit<MeteredOperationFilter, 'projectId'> = {}): Promise<MeteredOperation[]> {
    const limit = filter.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('Operation list limit must be between 1 and 500');
    }
    return this.requireStore().listMeteredOperations!({
      ...filter,
      limit,
      projectId: this.ledger.projectId,
    });
  }

  async claim(input: {
    operationKey: string;
    workerId: string;
  }): Promise<MeteredOperation | undefined> {
    const workerId = requireText(input.workerId, 'workerId');
    const outcome = await this.transaction(async (tx) => {
      const operation = await requireOperation(tx, this.ledger.projectId, input.operationKey);
      if (operation.status !== 'queued') return { operation: undefined, release: false };
      const reservation = await tx.getReservation(operation.reservationId);
      if (!reservation || reservation.projectId !== this.ledger.projectId) {
        throw new InvalidCreditStateError(`Operation reservation is missing: ${operation.id}`);
      }
      if (reservation.status !== 'open' || reservation.expiresAt <= this.now()) {
        await tx.saveMeteredOperation({
          ...operation,
          status: 'cancelled',
          updatedAt: this.now(),
          lastError: 'Reservation closed before provider execution',
        });
        return { operation: undefined, release: reservation.status === 'open' };
      }
      const claimed: MeteredOperation = {
        ...operation,
        status: 'running',
        workerId,
        claimToken: randomBytes(16).toString('hex'),
        claimedAt: this.now(),
        updatedAt: this.now(),
      };
      await tx.saveMeteredOperation(claimed);
      return { operation: claimed, release: false };
    });
    if (outcome.release) {
      await this.ledger.releaseReservation({
        reservationId: (await this.requireOperation(input.operationKey)).reservationId,
        idempotencyKey: `${operationId(this.ledger.projectId, input.operationKey)}:unstarted_release`,
        reason: 'operation_expired_before_execution',
      });
    }
    return outcome.operation;
  }

  async saveResult(input: SaveMeteredResultInput): Promise<MeteredOperation> {
    const result = normalizeResult(input.result);
    const resultHash = hash(result);
    return this.transaction(async (tx) => {
      const operation = await requireOperation(tx, this.ledger.projectId, input.operationKey);
      if (operation.resultHash) return sameResult(operation, resultHash);
      if (
        !['running', 'outcome_unknown'].includes(operation.status) ||
        operation.claimToken !== requireText(input.claimToken, 'claimToken')
      ) {
        throw new InvalidCreditStateError(
          `Operation is not claimed by this worker: ${operation.id}`,
        );
      }
      const saved: MeteredOperation = {
        ...operation,
        status: 'result_saved',
        savedResult: result,
        resultHash,
        resultSavedAt: this.now(),
        updatedAt: this.now(),
        lastError: undefined,
      };
      await tx.saveMeteredOperation(saved);
      return saved;
    });
  }

  async markOutcomeUnknown(input: {
    operationKey: string;
    reason: string;
  }): Promise<MeteredOperation> {
    const reason = requireText(input.reason, 'reason');
    return this.transaction(async (tx) => {
      const operation = await requireOperation(tx, this.ledger.projectId, input.operationKey);
      if (operation.status === 'outcome_unknown') return operation;
      if (operation.status !== 'running') {
        throw new InvalidCreditStateError(`Operation is ${operation.status}: ${operation.id}`);
      }
      const unknown: MeteredOperation = {
        ...operation,
        status: 'outcome_unknown',
        lastError: reason,
        updatedAt: this.now(),
      };
      await tx.saveMeteredOperation(unknown);
      return unknown;
    });
  }

  async recoverResult(input: RecoverMeteredResultInput): Promise<MeteredOperation> {
    const evidenceReference = requireText(input.evidenceReference, 'evidenceReference');
    const result = normalizeResult(input.result);
    const resultHash = hash(result);
    return this.transaction(async (tx) => {
      const operation = await requireOperation(tx, this.ledger.projectId, input.operationKey);
      if (operation.resultHash) return sameResult(operation, resultHash);
      if (operation.status !== 'outcome_unknown') {
        throw new InvalidCreditStateError(`Operation is ${operation.status}: ${operation.id}`);
      }
      const saved: MeteredOperation = {
        ...operation,
        status: 'result_saved',
        savedResult: result,
        resultHash,
        resultSavedAt: this.now(),
        updatedAt: this.now(),
        evidenceReference,
        lastError: undefined,
      };
      await tx.saveMeteredOperation(saved);
      return saved;
    });
  }

  async confirmNotExecuted(input: {
    operationKey: string;
    evidenceReference: string;
  }): Promise<MeteredOperation> {
    const evidenceReference = requireText(input.evidenceReference, 'evidenceReference');
    const operation = await this.transaction(async (tx) => {
      const current = await requireOperation(tx, this.ledger.projectId, input.operationKey);
      if (current.status === 'cancelled' && current.evidenceReference === evidenceReference)
        return current;
      if (current.status !== 'outcome_unknown') {
        throw new InvalidCreditStateError(`Operation is ${current.status}: ${current.id}`);
      }
      const reservation = await tx.getReservation(current.reservationId);
      if (reservation?.status === 'committed') {
        throw new InvalidCreditStateError(`Cannot cancel a charged operation: ${current.id}`);
      }
      const cancelled: MeteredOperation = {
        ...current,
        status: 'cancelled',
        evidenceReference,
        updatedAt: this.now(),
      };
      await tx.saveMeteredOperation(cancelled);
      return cancelled;
    });
    const reservation = await this.ledger.getReservation(operation.reservationId);
    if (reservation?.status === 'open') {
      await this.ledger.releaseReservation({
        reservationId: reservation.id,
        idempotencyKey: `${operation.id}:confirmed_not_executed`,
        reason: 'provider_not_executed',
      });
    }
    return operation;
  }

  async settle(
    operationKey: string,
  ): Promise<{ operation: MeteredOperation; receipt?: UsageReceipt }> {
    const operation = await this.requireOperation(operationKey);
    if (operation.status === 'settled') {
      return {
        operation,
        receipt: operation.receiptId
          ? await this.ledger.getUsageReceipt(operation.receiptId)
          : undefined,
      };
    }
    if (
      !['result_saved', 'needs_reconciliation'].includes(operation.status) ||
      !operation.savedResult
    ) {
      throw new InvalidCreditStateError(`Operation has no saved result: ${operation.id}`);
    }
    const reservationId = operation.settlementReservationId ?? operation.reservationId;
    let receipt: UsageReceipt;
    try {
      const committed = await this.ledger.commitUsage({
        reservationId,
        usageEventId: operation.savedResult.usageEventId,
        actualUsage: operation.savedResult.actualUsage,
        occurredAt: operation.savedResult.occurredAt,
        metadata: operation.savedResult.metadata,
        idempotencyKey: `${operation.id}:commit:${reservationId}`,
      });
      receipt = committed.receipt;
    } catch (error) {
      const reservation = await this.ledger.getReservation(reservationId);
      const needsReconciliation =
        error instanceof InvalidCreditStateError &&
        (reservation?.status !== 'open' ||
          (reservation.expiresAt ?? 0) <= this.now() ||
          error.message.startsWith('Actual charge exceeds reservation:'));
      if (!needsReconciliation) throw error;
      const unresolved = await this.transaction(async (tx) => {
        const current = await requireOperation(tx, this.ledger.projectId, operationKey);
        if (current.status === 'settled') return current;
        const next: MeteredOperation = {
          ...current,
          status: 'needs_reconciliation',
          lastError: String(error),
          updatedAt: this.now(),
        };
        await tx.saveMeteredOperation(next);
        return next;
      });
      return { operation: unresolved };
    }
    const chargedEvent = await this.ledger.store.getUsageEvent(receipt.usageEventId);
    if (
      receipt.usageEventId !== operation.savedResult.usageEventId ||
      receipt.projectId !== operation.projectId ||
      receipt.customerId !== operation.customerId ||
      hash(chargedEvent?.quantities) !== hash(operation.savedResult.actualUsage)
    ) {
      throw new InvalidCreditStateError(
        `Reservation was charged for a different result: ${operation.id}`,
      );
    }
    const settled = await this.transaction(async (tx) => {
      const current = await requireOperation(tx, this.ledger.projectId, operationKey);
      if (current.status === 'settled') return current;
      if (current.resultHash !== operation.resultHash) {
        throw new InvalidCreditStateError(`Operation result changed: ${operation.id}`);
      }
      const next: MeteredOperation = {
        ...current,
        status: 'settled',
        receiptId: receipt.id,
        settlementReservationId: reservationId,
        lastError: undefined,
        updatedAt: this.now(),
      };
      await tx.saveMeteredOperation(next);
      return next;
    });
    return { operation: settled, receipt };
  }

  async reconcile(
    operationKey: string,
  ): Promise<{ operation: MeteredOperation; receipt?: UsageReceipt }> {
    let operation = await this.requireOperation(operationKey);
    if (operation.status === 'settled') return this.settle(operationKey);
    if (operation.status !== 'needs_reconciliation' || !operation.savedResult) {
      throw new InvalidCreditStateError(`Operation does not need reconciliation: ${operation.id}`);
    }
    const alreadyCharged = await this.ledger.store.getUsageEvent(
      operation.savedResult.usageEventId,
    );
    if (
      alreadyCharged &&
      alreadyCharged.reservationId !==
        (operation.settlementReservationId ?? operation.reservationId)
    ) {
      throw new InvalidCreditStateError(
        `Saved usage event was charged by another reservation: ${operation.savedResult.usageEventId}`,
      );
    }
    const initial = await this.ledger.getReservation(operation.reservationId);
    if (initial?.status === 'open') {
      await this.ledger.releaseReservation({
        reservationId: initial.id,
        idempotencyKey: `${operation.id}:release_for_reconcile`,
        reason: 'saved_usage_requires_new_hold',
      });
    }

    let reservation = operation.settlementReservationId
      ? await this.ledger.getReservation(operation.settlementReservationId)
      : undefined;
    if (reservation?.status === 'committed') return this.settle(operationKey);
    if (!reservation || reservation.status !== 'open' || reservation.expiresAt <= this.now()) {
      operation = await this.transaction(async (tx) => {
        const current = await requireOperation(tx, this.ledger.projectId, operationKey);
        if (current.status === 'settled') return current;
        if (current.status !== 'needs_reconciliation') {
          throw new InvalidCreditStateError(`Operation is ${current.status}: ${current.id}`);
        }
        const currentReservation = current.settlementReservationId
          ? await tx.getReservation(current.settlementReservationId)
          : undefined;
        if (currentReservation?.status === 'open' && currentReservation.expiresAt > this.now()) {
          return current;
        }
        const next: MeteredOperation = {
          ...current,
          reconciliationAttempt:
            (current.reconciliationAttempt ?? 0) +
            (current.settlementReservationId || !current.reconciliationAttempt ? 1 : 0),
          settlementReservationId: undefined,
          updatedAt: this.now(),
        };
        await tx.saveMeteredOperation(next);
        return next;
      });
      if (operation.status === 'settled') return this.settle(operationKey);
      if (!operation.settlementReservationId) {
        reservation = await this.ledger.reserveCredits({
          customerId: operation.customerId,
          priceId: operation.priceId,
          estimatedUsage: operation.savedResult!.actualUsage,
          idempotencyKey: `${operation.id}:reconcile:${operation.reconciliationAttempt}`,
        });
        await this.transaction(async (tx) => {
          const current = await requireOperation(tx, this.ledger.projectId, operationKey);
          if (
            current.status !== 'needs_reconciliation' ||
            current.reconciliationAttempt !== operation.reconciliationAttempt
          )
            return;
          await tx.saveMeteredOperation({
            ...current,
            settlementReservationId: reservation!.id,
            updatedAt: this.now(),
          });
        });
      }
    }
    return this.settle(operationKey);
  }

  private async requireOperation(operationKey: string): Promise<MeteredOperation> {
    const operation = await this.get(operationKey);
    if (!operation) throw new CreditNotFoundError('Metered operation', operationKey);
    return operation;
  }

  private requireStore() {
    const store = this.ledger.store;
    if (
      typeof store.getMeteredOperation !== 'function' ||
      typeof store.listMeteredOperations !== 'function'
    ) {
      throw new UnsupportedCreditStoreCapabilityError('durable metered operations');
    }
    return store;
  }

  private transaction<T>(handler: (tx: OperationTransaction) => Promise<T>): Promise<T> {
    return this.requireStore().transaction(async (tx) => {
      if (
        typeof tx.getMeteredOperation !== 'function' ||
        typeof tx.saveMeteredOperation !== 'function'
      ) {
        throw new UnsupportedCreditStoreCapabilityError('durable metered operations');
      }
      return handler(tx as OperationTransaction);
    });
  }
}

async function requireOperation(tx: OperationTransaction, projectId: string, operationKey: string) {
  const operation = await tx.getMeteredOperation(
    projectId,
    requireText(operationKey, 'operationKey'),
  );
  if (!operation) throw new CreditNotFoundError('Metered operation', operationKey);
  return operation;
}

function sameRequest(operation: MeteredOperation, requestHash: string): MeteredOperation {
  if (operation.requestHash !== requestHash)
    throw new IdempotencyConflictError(operation.operationKey);
  return operation;
}

function sameResult(operation: MeteredOperation, resultHash: string): MeteredOperation {
  if (operation.resultHash !== resultHash)
    throw new IdempotencyConflictError(operation.operationKey);
  return operation;
}

function normalizeResult(result: MeteredProviderResult): MeteredProviderResult {
  requireText(result.usageEventId, 'usageEventId');
  if (
    !result.actualUsage ||
    typeof result.actualUsage !== 'object' ||
    Array.isArray(result.actualUsage)
  ) {
    throw new Error('actualUsage must be an object');
  }
  const normalized = {
    ...result,
    actualUsage: Object.fromEntries(
      Object.entries(result.actualUsage).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(normalized);
  } catch {
    throw new Error('Provider result must be JSON serializable');
  }
  if (!serialized || Buffer.byteLength(serialized) > MAX_RESULT_BYTES) {
    throw new Error('Provider result must be JSON serializable and at most 128 KiB');
  }
  return JSON.parse(serialized) as MeteredProviderResult;
}

function operationId(projectId: string, key: string): string {
  return `mop_${hash(`${projectId}\u0000${key}`).slice(0, 32)}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}

function requireText(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}
