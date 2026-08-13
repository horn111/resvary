import { signWebhookEvent, type WebhookEvent, type WebhookSignature } from '../receipts/index.js';
import type { CreditOutboxEvent } from './types.js';

export function createCreditWebhookEvent(event: CreditOutboxEvent): WebhookEvent {
  return {
    id: event.id,
    type: event.type,
    createdAt: event.createdAt,
    data: event.data,
  };
}

export function signCreditOutboxEvent(
  event: CreditOutboxEvent,
  secret: string,
  timestamp?: number,
): WebhookSignature {
  return signWebhookEvent(createCreditWebhookEvent(event), secret, timestamp);
}
