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
      headers: {
        'x-resvary-event-id': 'overridden',
        'x-resvary-signature': 'overridden',
        'content-type': 'text/plain',
        'x-custom-header': 'custom',
      },
    });

    const result = await transport.deliver(event, { signal: new AbortController().signal });

    expect(result).toMatchObject({ delivered: false, retryable: true, retryAfterMs: 2_000 });
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-resvary-event-id']).toBe(event.id);
    expect((init.headers as Record<string, string>)['x-resvary-signature']).toMatch(/^t=\d+,v1=/);
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect((init.headers as Record<string, string>)['x-custom-header']).toBe('custom');
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

  it.each([200, 202, 204, 299])('treats HTTP %i as a successful delivery', async (status) => {
    const transport = createHttpWebhookTransport({
      url: 'https://example.test/webhook',
      secret: 'secret',
      fetch: vi.fn().mockResolvedValue(new Response(null, { status })),
    });
    await expect(
      transport.deliver(event, { signal: new AbortController().signal }),
    ).resolves.toEqual({ delivered: true, retryable: false });
  });

  it.each([408, 429, 500, 503])('retries HTTP %i responses', async (status) => {
    const transport = createHttpWebhookTransport({
      url: 'https://example.test/webhook',
      secret: 'secret',
      fetch: vi.fn().mockResolvedValue(new Response(null, { status })),
    });
    await expect(
      transport.deliver(event, { signal: new AbortController().signal }),
    ).resolves.toMatchObject({ delivered: false, retryable: true });
  });

  it('retries network failures', async () => {
    const transport = createHttpWebhookTransport({
      url: 'https://example.test/webhook',
      secret: 'secret',
      fetch: vi.fn().mockRejectedValue(new Error('connection reset')),
    });
    await expect(
      transport.deliver(event, { signal: new AbortController().signal }),
    ).resolves.toMatchObject({
      delivered: false,
      retryable: true,
      error: 'connection reset',
    });
  });

  it('passes an already-aborted shutdown signal to fetch', async () => {
    const controller = new AbortController();
    controller.abort(new Error('shutdown'));
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      return Promise.reject(init?.signal?.reason);
    });
    const transport = createHttpWebhookTransport({
      url: 'https://example.test/webhook',
      secret: 'secret',
      fetch: fetcher,
    });

    await expect(transport.deliver(event, { signal: controller.signal })).resolves.toMatchObject({
      delivered: false,
      retryable: true,
      error: 'shutdown',
    });
  });

  it('rejects invalid transport configuration', () => {
    expect(() =>
      createHttpWebhookTransport({ url: 'file:///tmp/webhook', secret: 'secret' }),
    ).toThrow('http or https');
    expect(() => createHttpWebhookTransport({ url: 'https://example.test', secret: ' ' })).toThrow(
      'secret is required',
    );
    expect(() =>
      createHttpWebhookTransport({ url: 'https://example.test', secret: 'secret', timeoutMs: 0 }),
    ).toThrow('positive number');
  });
});
