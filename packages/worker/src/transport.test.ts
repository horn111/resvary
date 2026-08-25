import { describe, expect, it, vi } from 'vitest';
import type { CreditOutboxEvent } from '@resvary/sdk/credits';
import { createHttpWebhookTransport } from './transport.js';

const event: CreditOutboxEvent = {
  id: 'evt_transport',
  projectId: 'project',
  type: 'credit.granted',
  data: { accountId: 'account' },
  status: 'processing',
  createdAt: 1_000,
  attemptCount: 1,
  nextAttemptAt: 1_000,
  leaseOwner: 'worker',
  leaseExpiresAt: 31_000,
};

describe('HTTP webhook transport', () => {
  it('signs the payload, sends the event id, and honors Retry-After', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '2' } }));
    const transport = createHttpWebhookTransport({
      url: 'https://example.test/webhook',
      secret: 'secret',
      fetch: fetcher,
    });

    const result = await transport.deliver(event, { signal: new AbortController().signal });

    expect(result).toMatchObject({ delivered: false, retryable: true, retryAfterMs: 2_000 });
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-resvary-event-id']).toBe(event.id);
    expect((init.headers as Record<string, string>)['x-resvary-signature']).toMatch(/^t=\d+,v1=/);
  });

  it('treats ordinary 4xx responses as permanent failures', async () => {
    const transport = createHttpWebhookTransport({
      url: 'https://example.test/webhook',
      secret: 'secret',
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 400 })),
    });
    await expect(
      transport.deliver(event, { signal: new AbortController().signal }),
    ).resolves.toMatchObject({ delivered: false, retryable: false });
  });
});
