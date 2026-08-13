import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from '../receipts/index.js';
import { createCreditWebhookEvent, signCreditOutboxEvent } from './webhooks.js';

describe('credit outbox webhooks', () => {
  it('uses the existing Settlary signature format', () => {
    const event = {
      id: 'evt_credit',
      projectId: 'project_ai',
      type: 'usage.charged' as const,
      data: { usageReceiptId: 'urcpt_1' },
      status: 'pending' as const,
      createdAt: 1_700_000_000_000,
    };
    const payload = createCreditWebhookEvent(event);
    const signature = signCreditOutboxEvent(event, 'secret', 1_700_000_000);
    expect(
      verifyWebhookSignature({
        payload,
        header: signature.header,
        secret: 'secret',
        now: 1_700_000_000,
      }),
    ).toBe(true);
  });
});
