import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { DemoError } from './store';

export function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}
export function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function newSession(secret: string) {
  const payload = `${randomUUID()}.${Date.now() + 86_400_000}`;
  return `${payload}.${sign(`session:${payload}`, secret)}`;
}
export function customer(request: Request, secret: string) {
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('resvary_agent='))
    ?.slice(14);
  const parts = cookie?.split('.') ?? [];
  if (
    parts.length !== 3 ||
    !/^[0-9a-f-]{36}$/i.test(parts[0]) ||
    !Number.isSafeInteger(Number(parts[1])) ||
    Number(parts[1]) <= Date.now() ||
    !equal(parts[2], sign(`session:${parts[0]}.${parts[1]}`, secret))
  )
    throw new DemoError(401, 'Start a new demo session');
  return `visitor_${parts[0]}`;
}
export function sameOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin) throw new DemoError(403, 'Invalid request origin');
}
export function ipKey(request: Request, secret: string, trustedHeader?: string) {
  // Configure a proxy header only when the proxy overwrites it and the origin port is private.
  // Without a trusted proxy, all visitors share a conservative quota bucket.
  const ip = trustedHeader ? request.headers.get(trustedHeader)?.trim() : undefined;
  return sign(`ip:${ip && isIP(ip) ? ip : 'shared'}`, secret);
}
export function paymentToken(id: string, secret: string) {
  return sign(`topup:${id}`, secret);
}
export function authorizePayment(request: Request, id: string, secret: string) {
  if (!equal(request.headers.get('authorization') ?? '', `Bearer ${paymentToken(id, secret)}`))
    throw new DemoError(401, 'Payment executor required');
}
export async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new DemoError(400, 'JSON body required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32_768) throw new DemoError(413, 'Request is too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof DemoError) throw error;
    throw new DemoError(400, 'Invalid JSON');
  } finally {
    await reader.cancel().catch(() => {});
  }
}
