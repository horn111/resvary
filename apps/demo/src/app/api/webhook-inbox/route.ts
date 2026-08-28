import { verifyWebhookSignature } from '@resvary/sdk/receipts';
import { DEMO_WEBHOOK_TARGET, getDemoWebhookInbox, getDemoWebhookSecret } from './store';

export const dynamic = 'force-dynamic';

const MAX_WEBHOOK_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const secret = getDemoWebhookSecret();
  if (!secret) {
    return Response.json(
      { error: 'Webhook inbox is disabled until RESVARY_WEBHOOK_SECRET is configured.' },
      { status: 503 },
    );
  }

  const header = request.headers.get('x-resvary-signature');

  if (!header) {
    return Response.json({ error: 'Missing x-resvary-signature header' }, { status: 400 });
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: 'Webhook payload is too large' }, { status: 413 });
  }

  const payload = await request.text();
  if (Buffer.byteLength(payload) > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: 'Webhook payload is too large' }, { status: 413 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (!verifyWebhookSignature({ payload, header, secret, now })) {
    return Response.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  const inbox = await getDemoWebhookInbox();
  const delivery = await inbox.receive({
    payload,
    header,
    secret,
    now,
    target: DEMO_WEBHOOK_TARGET,
  });

  return Response.json({ delivery });
}
