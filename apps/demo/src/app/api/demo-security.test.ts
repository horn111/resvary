import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWebhookEvent,
  serializeWebhookPayload,
  signWebhookEvent,
} from '@resvary/sdk/receipts';
import { POST as gatewayPost } from './credits/gateway/route.js';
import { GET as receiptDemoGet } from './receipts/route.js';
import { requireDemoMutationAuthorization } from './demo-auth.js';
import { POST as webhookPost } from './webhook-inbox/route.js';
import { getDemoReceiptStore } from './webhook-inbox/store.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('demo security boundaries', () => {
  it('fails closed when the admin token is missing or wrong', async () => {
    vi.stubEnv('RESVARY_DEMO_ADMIN_TOKEN', '');
    expect(
      requireDemoMutationAuthorization(new Request('http://localhost/api/credits'))?.status,
    ).toBe(503);

    vi.stubEnv('RESVARY_DEMO_ADMIN_TOKEN', 'expected-token');
    expect(
      requireDemoMutationAuthorization(
        new Request('http://localhost/api/credits', {
          headers: { authorization: 'Bearer wrong-token' },
        }),
      )?.status,
    ).toBe(401);
    expect(
      requireDemoMutationAuthorization(
        new Request('http://localhost/api/credits', {
          headers: { authorization: 'Bearer expected-token' },
        }),
      ),
    ).toBeUndefined();
  });

  it('protects live Gateway initiation before it creates durable state', async () => {
    vi.stubEnv('RESVARY_DEMO_ADMIN_TOKEN', '');
    const missing = await gatewayPost(
      new Request('http://localhost/api/credits/gateway', { method: 'POST' }),
    );
    expect(missing.status).toBe(503);

    vi.stubEnv('RESVARY_DEMO_ADMIN_TOKEN', 'expected-token');
    const wrong = await gatewayPost(
      new Request('http://localhost/api/credits/gateway', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-token' },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  it('disables webhook writes and signed receipt setup without a secret', async () => {
    vi.stubEnv('RESVARY_WEBHOOK_SECRET', '');
    const webhook = await webhookPost(
      new Request('http://localhost/api/webhook-inbox', { method: 'POST' }),
    );
    expect(webhook.status).toBe(503);
    expect((await receiptDemoGet()).status).toBe(503);
  });

  it('rejects invalid webhooks before persistent delivery state is created', async () => {
    vi.stubEnv('RESVARY_WEBHOOK_SECRET', 'test-webhook-secret');
    const store = await getDemoReceiptStore();
    const before = (await store.listWebhookDeliveries()).length;
    const response = await webhookPost(
      new Request('http://localhost/api/webhook-inbox', {
        method: 'POST',
        headers: { 'x-resvary-signature': 't=1,v1=invalid' },
        body: JSON.stringify({ id: 'attacker-event' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await store.listWebhookDeliveries()).toHaveLength(before);
  });

  it('preserves valid signed webhook delivery', async () => {
    const secret = 'test-webhook-secret';
    vi.stubEnv('RESVARY_WEBHOOK_SECRET', secret);
    const store = await getDemoReceiptStore();
    const before = (await store.listWebhookDeliveries()).length;
    const event = createWebhookEvent('invoice.paid', { invoiceId: 'test-invoice' });
    const payload = serializeWebhookPayload(event);
    const response = await webhookPost(
      new Request('http://localhost/api/webhook-inbox', {
        method: 'POST',
        headers: { 'x-resvary-signature': signWebhookEvent(event, secret).header },
        body: payload,
      }),
    );

    expect(response.status).toBe(200);
    expect(await store.listWebhookDeliveries()).toHaveLength(before + 1);
  });
});
