/**
 * Local in-memory inbox for signed Resvary Receipts webhooks.
 */

import { randomBytes } from 'node:crypto';
import type {
  WebhookDeliveryAttempt,
  WebhookDeliveryStatus,
  WebhookEvent,
  WebhookEventType,
} from './types.js';
import { signWebhookEvent, verifyWebhookSignature } from './webhooks.js';

export interface ReceiveWebhookInput {
  payload: WebhookEvent | string;
  header: string;
  secret: string;
  target?: string;
  now?: number;
  receivedAt?: number;
  toleranceSeconds?: number;
}

export interface ReplayWebhookInput {
  event: WebhookEvent;
  secret: string;
  target?: string;
  replayOf?: string;
  timestamp?: number;
  receivedAt?: number;
}

export interface WebhookDeliveryFilter {
  eventId?: string;
  status?: WebhookDeliveryStatus;
}

export class WebhookInbox {
  private readonly deliveries: WebhookDeliveryAttempt[] = [];

  receive(input: ReceiveWebhookInput): WebhookDeliveryAttempt {
    const event = parseWebhookPayload(input.payload);
    const verified = verifyWebhookSignature({
      payload: input.payload,
      header: input.header,
      secret: input.secret,
      now: input.now,
      toleranceSeconds: input.toleranceSeconds,
    });

    const delivery = this.createDelivery({
      eventId: event.eventId,
      eventType: event.eventType,
      status: verified ? 'verified' : 'failed',
      verified,
      signatureHeader: input.header,
      receivedAt: input.receivedAt ?? Date.now(),
      target: input.target,
      error: verified ? undefined : 'Webhook signature verification failed',
    });

    this.deliveries.push(delivery);
    return delivery;
  }

  replay(input: ReplayWebhookInput): WebhookDeliveryAttempt {
    const signature = signWebhookEvent(input.event, input.secret, input.timestamp);

    const delivery = this.createDelivery({
      eventId: input.event.id,
      eventType: input.event.type,
      status: 'verified',
      verified: true,
      signatureHeader: signature.header,
      receivedAt: input.receivedAt ?? Date.now(),
      target: input.target,
      replayOf: input.replayOf,
    });

    this.deliveries.push(delivery);
    return delivery;
  }

  listDeliveries(filter: WebhookDeliveryFilter = {}): WebhookDeliveryAttempt[] {
    return this.deliveries.filter((delivery) => {
      if (filter.eventId && delivery.eventId !== filter.eventId) {
        return false;
      }

      if (filter.status && delivery.status !== filter.status) {
        return false;
      }

      return true;
    });
  }

  getDelivery(id: string): WebhookDeliveryAttempt | undefined {
    return this.deliveries.find((delivery) => delivery.id === id);
  }

  private createDelivery(input: Omit<WebhookDeliveryAttempt, 'id' | 'attempt'>): WebhookDeliveryAttempt {
    const attempt = this.deliveries.filter((delivery) => delivery.eventId === input.eventId).length + 1;

    return {
      id: `dlv_${randomBytes(12).toString('hex')}`,
      attempt,
      ...input,
    };
  }
}

function parseWebhookPayload(payload: WebhookEvent | string): {
  eventId: string;
  eventType: WebhookEventType | 'unknown';
} {
  const event = typeof payload === 'string'
    ? parseJson(payload)
    : payload;

  if (!isWebhookEventLike(event)) {
    return {
      eventId: 'unknown',
      eventType: 'unknown',
    };
  }

  return {
    eventId: event.id,
    eventType: event.type,
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isWebhookEventLike(value: unknown): value is WebhookEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const event = value as Partial<WebhookEvent>;
  return typeof event.id === 'string'
    && typeof event.type === 'string'
    && typeof event.createdAt === 'number'
    && 'data' in event;
}
