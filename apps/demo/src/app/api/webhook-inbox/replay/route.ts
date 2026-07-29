import type { WebhookEvent } from '@settlary/sdk/receipts';
import { DEMO_WEBHOOK_SECRET, DEMO_WEBHOOK_TARGET, getDemoWebhookInbox } from '../store';

export const dynamic = 'force-dynamic';

interface ReplayRequest {
  event?: WebhookEvent;
  replayOf?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as ReplayRequest;

  if (!body.event) {
    return Response.json(
      { error: 'Missing webhook event' },
      { status: 400 },
    );
  }

  const inbox = await getDemoWebhookInbox();
  const delivery = await inbox.replay({
    event: body.event,
    secret: DEMO_WEBHOOK_SECRET,
    target: DEMO_WEBHOOK_TARGET,
    replayOf: body.replayOf,
  });

  return Response.json({ delivery });
}
