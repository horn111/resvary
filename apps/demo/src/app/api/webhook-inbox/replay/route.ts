import type { WebhookEvent } from '@resvary/sdk/receipts';
import { requireDemoMutationAuthorization } from '../../demo-auth';
import { DEMO_WEBHOOK_TARGET, getDemoWebhookInbox, getDemoWebhookSecret } from '../store';

export const dynamic = 'force-dynamic';

interface ReplayRequest {
  event?: WebhookEvent;
  replayOf?: string;
}

export async function POST(request: Request) {
  const denied = requireDemoMutationAuthorization(request);
  if (denied) return denied;
  const secret = getDemoWebhookSecret();
  if (!secret) {
    return Response.json(
      { error: 'Webhook replay is disabled until RESVARY_WEBHOOK_SECRET is configured.' },
      { status: 503 },
    );
  }

  const body = (await request.json()) as ReplayRequest;

  if (!body.event) {
    return Response.json({ error: 'Missing webhook event' }, { status: 400 });
  }
  if (
    typeof body.event.id !== 'string' ||
    typeof body.event.type !== 'string' ||
    typeof body.event.createdAt !== 'number' ||
    !Number.isFinite(body.event.createdAt) ||
    !('data' in body.event)
  ) {
    return Response.json({ error: 'Invalid webhook event' }, { status: 400 });
  }

  const inbox = await getDemoWebhookInbox();
  const delivery = await inbox.replay({
    event: body.event,
    secret,
    target: DEMO_WEBHOOK_TARGET,
    replayOf: body.replayOf,
  });

  return Response.json({ delivery });
}
