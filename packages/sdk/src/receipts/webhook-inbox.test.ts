import { describe, expect, it } from 'vitest';
import { WebhookInbox } from './webhook-inbox.js';
import { createWebhookEvent, serializeWebhookPayload, signWebhookEvent } from './webhooks.js';

describe('WebhookInbox', () => {
  it('records a verified delivery for a valid signed webhook', () => {
    const inbox = new WebhookInbox();
    const event = createWebhookEvent('invoice.paid', { invoiceId: 'inv_123' }, 1_700_000_000_000);
    const signature = signWebhookEvent(event, 'secret', 1_700_000_000);

    const delivery = inbox.receive({
      payload: serializeWebhookPayload(event),
      header: signature.header,
      secret: 'secret',
      now: 1_700_000_000,
      receivedAt: 1_700_000_001_000,
      target: 'https://seller.app/webhooks/arc',
    });

    expect(delivery.status).toBe('verified');
    expect(delivery.verified).toBe(true);
    expect(delivery.eventId).toBe(event.id);
    expect(delivery.eventType).toBe('invoice.paid');
    expect(delivery.attempt).toBe(1);
    expect(delivery.target).toBe('https://seller.app/webhooks/arc');
    expect(inbox.getDelivery(delivery.id)).toEqual(delivery);
  });

  it('records failed deliveries for tampered and stale payloads', () => {
    const inbox = new WebhookInbox();
    const event = createWebhookEvent('invoice.paid', { invoiceId: 'inv_123' }, 1_700_000_000_000);
    const signature = signWebhookEvent(event, 'secret', 1_700_000_000);

    const tampered = inbox.receive({
      payload: serializeWebhookPayload({
        ...event,
        data: { invoiceId: 'inv_other' },
      }),
      header: signature.header,
      secret: 'secret',
      now: 1_700_000_000,
    });

    const stale = inbox.receive({
      payload: event,
      header: signature.header,
      secret: 'secret',
      now: 1_700_000_999,
    });

    expect(tampered.status).toBe('failed');
    expect(tampered.verified).toBe(false);
    expect(tampered.error).toMatch(/verification failed/i);
    expect(stale.status).toBe('failed');
    expect(stale.attempt).toBe(2);
  });

  it('replays a webhook with a new verified delivery attempt', () => {
    const inbox = new WebhookInbox();
    const event = createWebhookEvent('invoice.paid', { invoiceId: 'inv_123' }, 1_700_000_000_000);
    const signature = signWebhookEvent(event, 'secret', 1_700_000_000);

    const first = inbox.receive({
      payload: event,
      header: signature.header,
      secret: 'secret',
      now: 1_700_000_000,
    });

    const replay = inbox.replay({
      event,
      secret: 'secret',
      replayOf: first.id,
      timestamp: 1_700_000_100,
      receivedAt: 1_700_000_101_000,
    });

    expect(replay.status).toBe('verified');
    expect(replay.verified).toBe(true);
    expect(replay.attempt).toBe(2);
    expect(replay.replayOf).toBe(first.id);
    expect(replay.signatureHeader).toContain('t=1700000100');
  });

  it('filters delivery attempts by event id and status', () => {
    const inbox = new WebhookInbox();
    const paid = createWebhookEvent('invoice.paid', { invoiceId: 'inv_paid' }, 1_700_000_000_000);
    const expired = createWebhookEvent(
      'invoice.expired',
      { invoiceId: 'inv_expired' },
      1_700_000_000_000,
    );

    inbox.receive({
      payload: paid,
      header: signWebhookEvent(paid, 'secret', 1_700_000_000).header,
      secret: 'secret',
      now: 1_700_000_000,
    });
    inbox.receive({
      payload: expired,
      header: signWebhookEvent(expired, 'secret', 1_700_000_000).header,
      secret: 'wrong',
      now: 1_700_000_000,
    });

    expect(inbox.listDeliveries({ eventId: paid.id })).toHaveLength(1);
    expect(inbox.listDeliveries({ status: 'verified' })).toHaveLength(1);
    expect(inbox.listDeliveries({ status: 'failed' })).toHaveLength(1);
  });
});
