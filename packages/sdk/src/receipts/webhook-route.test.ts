import { describe, expect, it } from 'vitest';
import { createWebhookEvent, serializeWebhookPayload, signWebhookEvent } from './webhooks.js';
import { createWebhookRouteHandler } from './webhook-route.js';
import { InMemoryReceiptStore } from './store.js';

describe('createWebhookRouteHandler', () => {
  it('verifies and records a signed webhook delivery', async () => {
    const store = new InMemoryReceiptStore();
    const event = createWebhookEvent('invoice.paid', { invoiceId: 'inv_route' }, 1_700_000_000_000);
    const signature = signWebhookEvent(event, 'secret');
    const handler = createWebhookRouteHandler({
      secret: 'secret',
      store,
      toleranceSeconds: 600,
    });

    const response = await handler(new Request('https://seller.app/webhooks/arc', {
      method: 'POST',
      headers: { 'x-resvary-signature': signature.header },
      body: serializeWebhookPayload(event),
    }));
    const body = await response.json() as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(await store.listWebhookDeliveries({ eventId: event.id })).toHaveLength(1);
  });

  it('returns a typed failure for missing signature', async () => {
    const handler = createWebhookRouteHandler({ secret: 'secret' });

    const response = await handler(new Request('https://seller.app/webhooks/arc', {
      method: 'POST',
      body: '{}',
    }));
    const body = await response.json() as { ok: boolean; reason: string };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('missing_signature');
  });
});
