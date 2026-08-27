import { randomBytes } from 'node:crypto';
import type { WebhookDeliveryAttempt, WebhookEvent, WebhookEventType } from './types.js';
import type { ReceiptStore, ReceiptStoreDeliveryFilter } from './store.js';
import { signWebhookEvent, verifyWebhookSignature } from './webhooks.js';

export interface PersistentWebhookInboxConfig {
  store: ReceiptStore;
}

export interface PersistentReceiveWebhookInput {
  payload: WebhookEvent | string;
  header: string;
  secret: string;
  target?: string;
  now?: number;
  receivedAt?: number;
  toleranceSeconds?: number;
}

export interface PersistentReplayWebhookInput {
  event: WebhookEvent;
  secret: string;
  target?: string;
  replayOf?: string;
  timestamp?: number;
  receivedAt?: number;
}

export class PersistentWebhookInbox {
  private readonly store: ReceiptStore;

  constructor(config: PersistentWebhookInboxConfig) {
    this.store = config.store;
  }

  async receive(input: PersistentReceiveWebhookInput): Promise<WebhookDeliveryAttempt> {
    const event = parseWebhookPayload(input.payload);
    const verified = verifyWebhookSignature({
      payload: input.payload,
      header: input.header,
      secret: input.secret,
      now: input.now,
      toleranceSeconds: input.toleranceSeconds,
    });

    const delivery = await this.createDelivery({
      eventId: event.eventId,
      eventType: event.eventType,
      status: verified ? 'verified' : 'failed',
      verified,
      signatureHeader: input.header,
      receivedAt: input.receivedAt ?? Date.now(),
      target: input.target,
      error: verified ? undefined : 'Webhook signature verification failed',
    });

    await this.store.saveWebhookDelivery(delivery);
    return delivery;
  }

  async replay(input: PersistentReplayWebhookInput): Promise<WebhookDeliveryAttempt> {
    const signature = signWebhookEvent(input.event, input.secret, input.timestamp);

    const delivery = await this.createDelivery({
      eventId: input.event.id,
      eventType: input.event.type,
      status: 'verified',
      verified: true,
      signatureHeader: signature.header,
      receivedAt: input.receivedAt ?? Date.now(),
      target: input.target,
      replayOf: input.replayOf,
    });

    await this.store.saveWebhookDelivery(delivery);
    return delivery;
  }

  async listDeliveries(filter: ReceiptStoreDeliveryFilter = {}): Promise<WebhookDeliveryAttempt[]> {
    return this.store.listWebhookDeliveries(filter);
  }

  async getDelivery(id: string): Promise<WebhookDeliveryAttempt | undefined> {
    return this.store.getWebhookDelivery(id);
  }

  private async createDelivery(
    input: Omit<WebhookDeliveryAttempt, 'id' | 'attempt'>,
  ): Promise<WebhookDeliveryAttempt> {
    const attempts = await this.store.listWebhookDeliveries({ eventId: input.eventId });

    return {
      id: `dlv_${randomBytes(12).toString('hex')}`,
      attempt: attempts.length + 1,
      ...input,
    };
  }
}

function parseWebhookPayload(payload: WebhookEvent | string): {
  eventId: string;
  eventType: WebhookEventType | 'unknown';
} {
  const event = typeof payload === 'string' ? parseJson(payload) : payload;

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
  return (
    typeof event.id === 'string' &&
    typeof event.type === 'string' &&
    typeof event.createdAt === 'number' &&
    'data' in event
  );
}
