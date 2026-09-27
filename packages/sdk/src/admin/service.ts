import { createHash } from 'node:crypto';
import type { CreditLedger } from '../credits/ledger.js';
import type { CreditStore, OutboxDeliveryStore } from '../credits/store.js';
import { toCreditUnits } from '../credits/amount.js';
import { DurableMeteredOperations } from '../credits/operations.js';
import { summarizeOperation } from './operations.js';
import type {
  AdminQueryStore,
  OperatorAction,
  OperatorActionStatus,
  OperatorActionType,
} from './types.js';

export interface OperatorServiceConfig {
  projectId: string;
  ledger: CreditLedger;
  adminStore: AdminQueryStore;
  deliveryStore: CreditStore & OutboxDeliveryStore;
  now?: () => number;
}

interface OperatorCommandBase {
  actionId: string;
  reason: string;
}

export interface OperatorGrantInput extends OperatorCommandBase {
  customerId: string;
  amount: string;
}

export interface OperatorAdjustInput extends OperatorCommandBase {
  customerId: string;
  amount: string;
}

export interface OperatorExpireOverdueInput extends OperatorCommandBase {
  before?: number;
}

export interface OperatorRequeueInput extends OperatorCommandBase {
  eventId: string;
}

export interface OperatorOperationInput extends OperatorCommandBase {
  operationKey: string;
}

export interface OperatorSettlementInput extends OperatorOperationInput {
  /** Bind approval to the immutable result the operator reviewed. */
  resultHash: string;
}

export interface OperatorNonExecutionInput extends OperatorOperationInput {
  evidenceReference: string;
}

export class OperatorService {
  private readonly now: () => number;

  constructor(private readonly config: OperatorServiceConfig) {
    if (!config.projectId.trim()) throw new Error('Operator projectId is required');
    if (config.ledger.projectId !== config.projectId) {
      throw new Error('Operator service and ledger must use the same projectId');
    }
    this.now = config.now ?? Date.now;
  }

  settleOperation(input: OperatorSettlementInput) {
    return this.operationCommand(input, 'operation.settle');
  }

  reconcileOperation(input: OperatorSettlementInput) {
    return this.operationCommand(input, 'operation.reconcile');
  }

  markOperationUnknown(input: OperatorOperationInput) {
    return this.operationCommand(input, 'operation.mark_unknown');
  }

  confirmOperationNotExecuted(input: OperatorNonExecutionInput) {
    return this.operationCommand(input, 'operation.confirm_not_executed');
  }

  private async operationCommand(
    input: OperatorOperationInput & { resultHash?: string; evidenceReference?: string },
    type:
      | 'operation.settle'
      | 'operation.reconcile'
      | 'operation.mark_unknown'
      | 'operation.confirm_not_executed',
  ) {
    const operationKey = requireText(input.operationKey, 'operationKey');
    const charging = type === 'operation.settle' || type === 'operation.reconcile';
    const resultHash = charging ? requireText(input.resultHash ?? '', 'resultHash') : undefined;
    if (charging && !/^[a-f0-9]{64}$/.test(resultHash!))
      throw new Error('Invalid operation result hash');
    const evidenceReference =
      type === 'operation.confirm_not_executed'
        ? requireText(input.evidenceReference ?? '', 'evidenceReference')
        : undefined;
    if (evidenceReference && evidenceReference.length > 500)
      throw new Error('Evidence reference is limited to 500 characters');
    const operations = new DurableMeteredOperations(this.config.ledger, { now: this.now });
    const reviewed = await operations.get(operationKey);
    return this.execute(
      input,
      type,
      'metered_operation',
      operationKey,
      {
        resultHash: resultHash ?? null,
        evidenceReference: evidenceReference ?? null,
      },
      async (_pending, existing) => {
        const before = await operations.get(operationKey);
        if (!before) throw new Error('Metered operation not found');
        if (charging && before.resultHash !== resultHash)
          throw new Error('Saved result does not match the reviewed operation');
        let after;
        if (type === 'operation.settle') after = (await operations.settle(operationKey)).operation;
        else if (type === 'operation.reconcile')
          after = (await operations.reconcile(operationKey)).operation;
        else if (type === 'operation.mark_unknown')
          after = await operations.markOutcomeUnknown({
            operationKey,
            reason: input.reason.trim(),
          });
        else
          after = await operations.confirmNotExecuted({
            operationKey,
            evidenceReference: evidenceReference!,
          });
        return {
          fromStatus: existing?.command?.fromStatus ?? reviewed?.status ?? before.status,
          operation: summarizeOperation(after),
          resolved: after.status === 'settled' || after.status === 'cancelled',
        };
      },
      { fromStatus: reviewed?.status ?? null },
    );
  }

  grantCredits(input: OperatorGrantInput) {
    const amountUnits = toCreditUnits(input.amount);
    if (amountUnits <= 0n) throw new Error('Operator grant amount must be positive');
    return this.execute(
      input,
      'credit.grant',
      'customer',
      input.customerId,
      { amountUnits: amountUnits.toString() },
      () =>
        this.config.ledger.grantCredits({
          customerId: input.customerId,
          amount: input.amount,
          source: 'manual',
          idempotencyKey: this.idempotencyKey(input.actionId),
          metadata: this.metadata(input),
        }),
    );
  }

  adjustCredits(input: OperatorAdjustInput) {
    return this.execute(
      input,
      'credit.adjust',
      'customer',
      input.customerId,
      { amountUnits: signedUnits(input.amount).toString() },
      () =>
        this.config.ledger.adjustCredits({
          customerId: input.customerId,
          amount: input.amount,
          reason: input.reason,
          idempotencyKey: this.idempotencyKey(input.actionId),
          metadata: this.metadata(input),
        }),
    );
  }

  expireOverdueReservations(input: OperatorExpireOverdueInput) {
    const currentTime = this.now();
    const before = input.before ?? currentTime;
    if (!Number.isSafeInteger(before)) throw new Error('Operator expiry time must be an integer');
    if (before > currentTime) throw new Error('Operator expiry time cannot be in the future');
    return this.execute(
      input,
      'reservation.expire_overdue',
      'project',
      this.config.projectId,
      { before: input.before ?? null },
      (_pendingRecovery, existing) =>
        this.config.ledger.releaseExpiredReservations({
          now:
            input.before ??
            (typeof existing?.command?.effectiveBefore === 'number'
              ? existing.command.effectiveBefore
              : before),
          idempotencyKey: this.idempotencyKey(input.actionId),
        }),
      { effectiveBefore: before },
    );
  }

  async requeueDeadLetter(input: OperatorRequeueInput) {
    return this.execute(
      input,
      'outbox.requeue',
      'outbox_event',
      input.eventId,
      {},
      async (pendingRecovery) => {
        const event = await this.config.deliveryStore.getOutboxEvent(input.eventId);
        if (!event || event.projectId !== this.config.projectId) {
          throw new Error(`Outbox event not found: ${input.eventId}`);
        }
        if (pendingRecovery && event.status === 'pending' && event.attemptCount === 0) return event;
        if (event.status !== 'dead_letter') {
          throw new Error(`Outbox event is not dead-lettered: ${input.eventId}`);
        }
        await this.config.deliveryStore.requeueOutboxEvent(input.eventId, this.now());
        return this.config.deliveryStore.getOutboxEvent(input.eventId);
      },
    );
  }

  private async execute<T>(
    input: OperatorCommandBase,
    type: OperatorActionType,
    targetType: OperatorAction['targetType'],
    targetId: string,
    command: Record<string, unknown>,
    operation: (pendingRecovery: boolean, existing?: OperatorAction) => Promise<T>,
    generatedCommand: Record<string, unknown> = {},
  ): Promise<{ action: OperatorAction; result: T }> {
    const actionId = requireUuid(input.actionId);
    const reason = requireText(input.reason, 'reason');
    const existing = await this.config.adminStore.getOperatorAction(
      this.config.projectId,
      actionId,
    );
    if (existing) {
      this.assertSameCommand(existing, type, targetType, targetId, reason, command);
      if (existing.status === 'succeeded') {
        return { action: existing, result: existing.result as T };
      }
      if (existing.status === 'failed') throw new Error(existing.error ?? 'Operator action failed');
    } else {
      await this.config.adminStore.appendOperatorAction({
        id: actionId,
        sequence: 0,
        projectId: this.config.projectId,
        type,
        targetType,
        targetId,
        reason,
        command: { ...command, ...generatedCommand },
        commandHash: hashCommand(command),
        status: 'pending',
        createdAt: this.now(),
      });
    }

    let result: T;
    try {
      result = await operation(existing?.status === 'pending', existing);
    } catch (error) {
      await this.appendOutcome(
        actionId,
        type,
        targetType,
        targetId,
        reason,
        existing?.command ?? { ...command, ...generatedCommand },
        existing?.commandHash ?? hashCommand(command),
        'failed',
        undefined,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    const action = await this.appendOutcome(
      actionId,
      type,
      targetType,
      targetId,
      reason,
      existing?.command ?? { ...command, ...generatedCommand },
      existing?.commandHash ?? hashCommand(command),
      'succeeded',
      result,
    );
    return { action, result };
  }

  private async appendOutcome(
    id: string,
    type: OperatorActionType,
    targetType: OperatorAction['targetType'],
    targetId: string,
    reason: string,
    command: Record<string, unknown>,
    commandHash: string,
    status: Exclude<OperatorActionStatus, 'pending'>,
    result?: unknown,
    error?: string,
  ): Promise<OperatorAction> {
    const pending = await this.config.adminStore.getOperatorAction(this.config.projectId, id);
    if (pending?.status === 'succeeded') return pending;
    const action: OperatorAction = {
      id,
      sequence: (pending?.sequence ?? 0) + 1,
      projectId: this.config.projectId,
      type,
      targetType,
      targetId,
      reason,
      command,
      commandHash,
      status,
      createdAt: pending?.createdAt ?? this.now(),
      completedAt: this.now(),
      result,
      error,
    };
    await this.config.adminStore.appendOperatorAction(action);
    return action;
  }

  private assertSameCommand(
    action: OperatorAction,
    type: OperatorActionType,
    targetType: OperatorAction['targetType'],
    targetId: string,
    reason: string,
    command: Record<string, unknown>,
  ) {
    if (
      action.type !== type ||
      action.targetType !== targetType ||
      action.targetId !== targetId ||
      action.reason !== reason ||
      (action.commandHash !== undefined && action.commandHash !== hashCommand(command))
    ) {
      throw new Error(`Operator action id ${action.id} was already used for another command`);
    }
  }

  private idempotencyKey(actionId: string) {
    return `operator:${this.config.projectId}:${actionId}`;
  }

  private metadata(input: OperatorCommandBase) {
    return {
      source: 'operator_console',
      operatorActionId: input.actionId,
      reason: input.reason,
    };
  }
}

function signedUnits(amount: string): bigint {
  const normalized = amount.trim();
  return normalized.startsWith('-')
    ? -toCreditUnits(normalized.slice(1))
    : toCreditUnits(normalized);
}

function hashCommand(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Operator ${field} is required`);
  return normalized;
}

function requireUuid(value: string): string {
  const actionId = requireText(value, 'actionId');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actionId)
  ) {
    throw new Error('Operator actionId must be a UUID');
  }
  return actionId;
}
