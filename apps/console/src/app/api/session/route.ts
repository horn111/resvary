import { NextResponse } from 'next/server';
import {
  AuthError,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  clientAddress,
  consumeLoginAttempt,
  createSessionToken,
  assertSameOrigin,
  verifyAdminSecret,
} from '@/lib/auth';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { secret?: string };
    const valid = verifyAdminSecret(body.secret ?? '');
    consumeLoginAttempt(clientAddress(request), valid);
    if (!valid) return NextResponse.json({ error: 'Invalid admin secret' }, { status: 401 });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, createSessionToken(), SESSION_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Invalid login request' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 400;
    return NextResponse.json({ error: 'Request origin is not allowed' }, { status });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
