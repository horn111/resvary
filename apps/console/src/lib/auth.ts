import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getConsoleConfig } from './config';

export const SESSION_COOKIE = '__Host-resvary-console';
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  maxAge: SESSION_TTL_MS / 1_000,
} as const;
const failedLogins = new Map<string, { count: number; resetAt: number }>();

export async function requireSession(): Promise<void> {
  if (getConsoleConfig().demoMode) return;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !verifySessionToken(token)) redirect('/login');
}

export function verifyAdminSecret(candidate: string): boolean {
  const expected = Buffer.from(getConsoleConfig().adminSecret);
  const supplied = Buffer.from(candidate);
  const padded = Buffer.alloc(expected.length);
  supplied.copy(padded, 0, 0, expected.length);
  return timingSafeEqual(expected, padded) && supplied.length === expected.length;
}

export function createSessionToken(now = Date.now()): string {
  const config = getConsoleConfig();
  const payload = Buffer.from(
    JSON.stringify({
      issuedAt: now,
      expiresAt: now + SESSION_TTL_MS,
      nonce: randomBytes(16).toString('base64url'),
      secretVersion: secretVersion(config.adminSecret),
    }),
  ).toString('base64url');
  return `${payload}.${sign(payload, config.adminSecret)}`;
}

export function verifySessionToken(token: string, now = Date.now()): boolean {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const config = getConsoleConfig();
  const expected = sign(payload, config.adminSecret);
  const supplied = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (supplied.length !== expectedBuffer.length || !timingSafeEqual(supplied, expectedBuffer)) {
    return false;
  }
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      expiresAt: number;
      secretVersion: string;
    };
    return (
      Number.isSafeInteger(session.expiresAt) &&
      session.expiresAt > now &&
      session.secretVersion === secretVersion(config.adminSecret)
    );
  } catch {
    return false;
  }
}

export async function requireApiSession(request: Request): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !verifySessionToken(token)) throw new AuthError(401, 'Authentication required');
  assertSameOrigin(request);
}

export function consumeLoginAttempt(key: string, success: boolean, now = Date.now()): void {
  const state = failedLogins.get(key);
  if (state && state.resetAt <= now) failedLogins.delete(key);
  const active = failedLogins.get(key);
  if (active && active.count >= 5)
    throw new AuthError(429, 'Too many login attempts; retry in 15 minutes');
  if (success) {
    failedLogins.delete(key);
    return;
  }
  failedLogins.set(key, { count: (active?.count ?? 0) + 1, resetAt: now + 15 * 60_000 });
}

export function clientAddress(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  let suppliedOrigin: URL;
  try {
    suppliedOrigin = new URL(origin ?? '');
  } catch {
    throw new AuthError(403, 'Request origin is not allowed');
  }
  if (
    !host ||
    suppliedOrigin.host !== host ||
    !['http:', 'https:'].includes(suppliedOrigin.protocol) ||
    (suppliedOrigin.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(suppliedOrigin.hostname))
  ) {
    throw new AuthError(403, 'Request origin is not allowed');
  }
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') throw new AuthError(403, 'Cross-site request rejected');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function secretVersion(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}
