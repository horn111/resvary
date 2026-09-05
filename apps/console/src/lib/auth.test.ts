import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthError,
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  assertSameOrigin,
  consumeLoginAttempt,
  createSessionToken,
  verifyAdminSecret,
  verifySessionToken,
} from './auth';
import { getConsoleConfig } from './config';

const original = { ...process.env };

beforeEach(() => {
  process.env.RESVARY_PROJECT_ID = 'project_test';
  process.env.RESVARY_CONSOLE_ADMIN_SECRET = 'test-admin-secret-that-is-longer-than-32';
  delete process.env.DATABASE_URL;
  process.env.RESVARY_SQLITE_PATH = './test.sqlite';
  delete process.env.RESVARY_CONSOLE_DEMO_MODE;
});

afterEach(() => {
  process.env = { ...original };
});

describe('console authentication', () => {
  it('compares the admin secret exactly and invalidates sessions after rotation', () => {
    expect(verifyAdminSecret('test-admin-secret-that-is-longer-than-32')).toBe(true);
    expect(verifyAdminSecret('test-admin-secret-that-is-longer-than-33')).toBe(false);
    expect(verifyAdminSecret('short')).toBe(false);
    const token = createSessionToken(1_000);
    expect(verifySessionToken(token, 2_000)).toBe(true);
    process.env.RESVARY_CONSOLE_ADMIN_SECRET = 'rotated-admin-secret-that-is-longer-than-32';
    expect(verifySessionToken(token, 2_000)).toBe(false);
  });

  it('rejects expired and tampered sessions', () => {
    const token = createSessionToken(1_000);
    expect(verifySessionToken(token, 1_000 + 13 * 60 * 60 * 1_000)).toBe(false);
    expect(verifySessionToken(`${token.slice(0, -1)}x`, 2_000)).toBe(false);
  });

  it('requires an exact same-origin mutation request', () => {
    expect(() =>
      assertSameOrigin(
        new Request('https://console.example.test/api/operator', {
          headers: {
            origin: 'https://console.example.test',
            host: 'console.example.test',
            'sec-fetch-site': 'same-origin',
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        new Request('https://console.example.test/api/operator', {
          headers: {
            origin: 'https://attacker.example',
            host: 'console.example.test',
            'sec-fetch-site': 'cross-site',
          },
        }),
      ),
    ).toThrow(AuthError);
    expect(() =>
      assertSameOrigin(
        new Request('https://console.example.test/api/operator', {
          headers: {
            origin: 'https://attacker.example',
            host: 'console.example.test',
            'x-forwarded-host': 'attacker.example',
            'x-forwarded-proto': 'https',
          },
        }),
      ),
    ).toThrow(AuthError);
  });

  it('uses a host-only hardened session cookie policy', () => {
    expect(SESSION_COOKIE).toBe('__Host-resvary-console');
    expect(SESSION_COOKIE_OPTIONS).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
    expect(SESSION_COOKIE_OPTIONS.maxAge).toBe(12 * 60 * 60);
  });

  it('throttles repeated login failures per address', () => {
    const key = `test-${crypto.randomUUID()}`;
    for (let index = 0; index < 5; index += 1) consumeLoginAttempt(key, false, 1_000);
    expect(() => consumeLoginAttempt(key, false, 1_001)).toThrow('Too many login attempts');
    consumeLoginAttempt(key, true, 16 * 60_000);
    expect(() => consumeLoginAttempt(key, false, 16 * 60_000)).not.toThrow();
  });
});

describe('console configuration', () => {
  it('requires a 32-character secret and exactly one backend', () => {
    process.env.RESVARY_CONSOLE_ADMIN_SECRET = 'short';
    expect(() => getConsoleConfig()).toThrow('at least 32');
    process.env.RESVARY_CONSOLE_ADMIN_SECRET = 'test-admin-secret-that-is-longer-than-32';
    process.env.DATABASE_URL = 'postgres://example';
    expect(() => getConsoleConfig()).toThrow('exactly one');
  });

  it('locks public demo mode to the bundled SQLite fixture', () => {
    process.env.RESVARY_CONSOLE_DEMO_MODE = 'true';
    delete process.env.RESVARY_SQLITE_PATH;
    expect(getConsoleConfig()).toMatchObject({ demoMode: true, backend: { kind: 'sqlite' } });
    process.env.DATABASE_URL = 'postgres://example';
    expect(() => getConsoleConfig()).toThrow('refuses DATABASE_URL');
  });
});
