import { timingSafeEqual } from 'node:crypto';

export function requireDemoMutationAuthorization(request: Request): Response | undefined {
  const expectedToken = process.env.RESVARY_DEMO_ADMIN_TOKEN;
  if (!expectedToken) {
    return Response.json(
      { error: 'Demo mutations are disabled until RESVARY_DEMO_ADMIN_TOKEN is configured.' },
      { status: 503 },
    );
  }

  const authorization = request.headers.get('authorization');
  const providedToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined;
  if (!providedToken || !safeEqual(providedToken, expectedToken)) {
    return Response.json(
      { error: 'Unauthorized demo mutation.' },
      { status: 401, headers: { 'www-authenticate': 'Bearer' } },
    );
  }

  return undefined;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
