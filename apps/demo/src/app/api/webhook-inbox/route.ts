import { DEMO_WEBHOOK_SECRET, DEMO_WEBHOOK_TARGET, getDemoWebhookInbox } from './store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const payload = await request.text();
  const header = request.headers.get('x-resvary-signature');

  if (!header) {
    return Response.json(
      { error: 'Missing x-resvary-signature header' },
      { status: 400 },
    );
  }

  const inbox = await getDemoWebhookInbox();
  const delivery = await inbox.receive({
    payload,
    header,
    secret: DEMO_WEBHOOK_SECRET,
    target: DEMO_WEBHOOK_TARGET,
  });

  return Response.json({ delivery });
}
