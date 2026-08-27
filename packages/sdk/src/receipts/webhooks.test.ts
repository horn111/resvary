import { describe, expect, it } from 'vitest';
import {
  createWebhookEvent,
  serializeWebhookPayload,
  signWebhookEvent,
  verifyWebhookSignature,
} from './webhooks.js';

describe('webhook signatures', () => {
  it('signs and verifies webhook events', () => {
    const event = createWebhookEvent('invoice.paid', { invoiceId: 'inv_123' }, 1_700_000_000_000);
    const signature = signWebhookEvent(event, 'secret', 1_700_000_000);

    expect(
      verifyWebhookSignature({
        payload: event,
        header: signature.header,
        secret: 'secret',
        now: 1_700_000_000,
      }),
    ).toBe(true);
  });

  it('rejects tampered payloads and stale signatures', () => {
    const event = createWebhookEvent('invoice.paid', { invoiceId: 'inv_123' }, 1_700_000_000_000);
    const signature = signWebhookEvent(event, 'secret', 1_700_000_000);
    const tamperedPayload = serializeWebhookPayload({
      ...event,
      data: { invoiceId: 'inv_other' },
    });

    expect(
      verifyWebhookSignature({
        payload: tamperedPayload,
        header: signature.header,
        secret: 'secret',
        now: 1_700_000_000,
      }),
    ).toBe(false);

    expect(
      verifyWebhookSignature({
        payload: event,
        header: signature.header,
        secret: 'secret',
        now: 1_700_000_999,
      }),
    ).toBe(false);
  });
});
