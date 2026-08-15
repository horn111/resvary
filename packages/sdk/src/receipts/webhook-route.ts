import { WebhookInbox } from './webhook-inbox.js';
import { PersistentWebhookInbox } from './persistent-webhook-inbox.js';
import type { ReceiptStore } from './store.js';
import type { WebhookDeliveryAttempt } from './types.js';

export interface WebhookRouteHandlerConfig {
  secret: string;
  target?: string;
  inbox?: WebhookInbox | PersistentWebhookInbox;
  store?: ReceiptStore;
  toleranceSeconds?: number;
}

export type WebhookRouteResult =
  | {
      ok: true;
      delivery: WebhookDeliveryAttempt;
    }
  | {
      ok: false;
      error: string;
      reason: 'missing_signature' | 'signature_verification_failed';
      delivery?: WebhookDeliveryAttempt;
    };

export function createWebhookRouteHandler(config: WebhookRouteHandlerConfig) {
  return async function handleWebhook(request: Request): Promise<Response> {
    const payload = await request.text();
    const header = request.headers.get('x-resvary-signature');

    if (!header) {
      return Response.json(
        {
          ok: false,
          error: 'Missing x-resvary-signature header',
          reason: 'missing_signature',
        } satisfies WebhookRouteResult,
        { status: 400 },
      );
    }

    const inbox = config.inbox
      ?? (config.store ? new PersistentWebhookInbox({ store: config.store }) : new WebhookInbox());
    const delivery = await inbox.receive({
      payload,
      header,
      secret: config.secret,
      target: config.target,
      toleranceSeconds: config.toleranceSeconds,
    });

    if (!delivery.verified) {
      return Response.json(
        {
          ok: false,
          error: delivery.error ?? 'Webhook signature verification failed',
          reason: 'signature_verification_failed',
          delivery,
        } satisfies WebhookRouteResult,
        { status: 400 },
      );
    }

    return Response.json({
      ok: true,
      delivery,
    } satisfies WebhookRouteResult);
  };
}
