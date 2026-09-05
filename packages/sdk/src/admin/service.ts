import type { CreditLedger } from '../credits/ledger.js';
import type { CreditStore, OutboxDeliveryStore } from '../credits/store.js';
import { toCreditUnits } from '../credits/amount.js';
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

export class OperatorService {
  private readonly now: () => number;

  constructor(private readonly config: OperatorServiceConfig) {
    if (!config.projectId.trim()) throw new Error('Operator projectId is required');
    if (config.ledger.projectId !== config.projectId) {
      throw new Error('Operator service and ledger must use the same projectId');
    }
    this.now = config.now ?? Date.now;
  }

  grantCredits(input: OperatorGrantInput) {
    if (toCreditUnits(input.amount) <= 0n)
      throw new Error('Operator grant amount must be positive');
    return this.execute(input, 'credit.grant', 'customer', input.customerId, () =>
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
    return this.execute(input, 'credit.adjust', 'customer', input.customerId, () =>
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
    return this.execute(input, 'reservation.expire_overdue', 'project', this.config.projectId, () =>
      this.config.ledger.releaseExpiredReservations({
        now: before,
        idempotencyKey: this.idempotencyKey(input.actionId),
      }),
    );
  }

  async requeueDeadLetter(input: OperatorRequeueInput) {
    return this.execute(
      input,
      'outbox.requeue',
      'outbox_event',
      input.eventId,
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
    operation: (pendingRecovery: boolean) => Promise<T>,
  ): Promise<{ action: OperatorAction; result: T }> {
    const actionId = requireUuid(input.actionId);
    const reason = requireText(input.reason, 'reason');
    const existing = await this.config.adminStore.getOperatorAction(
      this.config.projectId,
      actionId,
    );
    if (existing) {
      this.assertSameCommand(existing, type, targetType, targetId, reason);
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
        status: 'pending',
        createdAt: this.now(),
      });
    }

    let result: T;
    try {
      result = await operation(existing?.status === 'pending');
    } catch (error) {
      await this.appendOutcome(
        actionId,
        type,
        targetType,
        targetId,
        reason,
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
  ) {
    if (
      action.type !== type ||
      action.targetType !== targetType ||
      action.targetId !== targetId ||
      action.reason !== reason
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
