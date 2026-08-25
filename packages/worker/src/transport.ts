import {
  createCreditWebhookEvent,
  signCreditOutboxEvent,
  type CreditOutboxEvent,
} from '@resvary/sdk/credits';
import { serializeWebhookPayload } from '@resvary/sdk/receipts';

export interface OutboxTransportContext {
  signal: AbortSignal;
}

export interface OutboxTransportResult {
  delivered: boolean;
  retryable: boolean;
  retryAfterMs?: number;
  error?: string;
}

export interface OutboxTransport {
  deliver(
    event: CreditOutboxEvent,
    context: OutboxTransportContext,
  ): Promise<OutboxTransportResult>;
}

export interface HttpWebhookTransportConfig {
  url: string;
  secret: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
}

export function createHttpWebhookTransport(config: HttpWebhookTransportConfig): OutboxTransport {
  const fetcher = config.fetch ?? globalThis.fetch;
  if (!fetcher) throw new Error('A Fetch API implementation is required');
  const timeoutMs = config.timeoutMs ?? 10_000;
  return {
    async deliver(event, context) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error('Webhook delivery timed out')),
        timeoutMs,
      );
      const abort = () => controller.abort(context.signal.reason);
      context.signal.addEventListener('abort', abort, { once: true });
      try {
        const webhook = createCreditWebhookEvent(event);
        const signature = signCreditOutboxEvent(event, config.secret);
        const response = await fetcher(config.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-resvary-signature': signature.header,
            'x-resvary-event-id': event.id,
            ...config.headers,
          },
          body: serializeWebhookPayload(webhook),
          signal: controller.signal,
        });
        if (response.ok) return { delivered: true, retryable: false };
        const retryable =
          response.status === 408 || response.status === 429 || response.status >= 500;
        return {
          delivered: false,
          retryable,
          retryAfterMs: retryable
            ? parseRetryAfter(response.headers.get('retry-after'))
            : undefined,
          error: `Webhook endpoint returned HTTP ${response.status}`,
        };
      } catch (error) {
        return {
          delivered: false,
          retryable: true,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearTimeout(timeout);
        context.signal.removeEventListener('abort', abort);
      }
    },
  };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - Date.now());
}
