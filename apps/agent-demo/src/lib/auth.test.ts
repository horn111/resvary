import { describe, expect, it } from 'vitest';
import { customer, equal, newSession, sameOrigin, boundedJson } from './auth';
import { estimate, RUN_BUDGET_UNITS } from './config';
const secret = 'test-secret-not-for-production-1234567890';
describe('session and input boundary', () => {
  it('accepts only a signed session and rejects tampering', () => {
    const token = newSession(secret);
    expect(
      customer(
        new Request('http://localhost', { headers: { cookie: `resvary_agent=${token}` } }),
        secret,
      ),
    ).toMatch(/^visitor_/);
    expect(() =>
      customer(
        new Request('http://localhost', { headers: { cookie: `resvary_agent=${token}bad` } }),
        secret,
      ),
    ).toThrow();
    expect(equal('é', 'a')).toBe(false);
  });
  it('checks exact origin and byte limits, including multibyte text', () => {
    expect(() =>
      sameOrigin(
        new Request('http://localhost', { headers: { origin: 'https://evil.example' } }),
        'http://localhost',
      ),
    ).toThrow();
    expect(() => estimate('я'.repeat(6145))).toThrow();
    expect(() => estimate(' ')).toThrow();
    expect(Number(estimate('x'.repeat(12288)).input_tokens)).toBeLessThan(16000);
    expect(RUN_BUDGET_UNITS).toBeGreaterThan(8 * (16000 * 2 + 512 * 8) + 16000 * 2 + 1024 * 8);
  });
  it('rejects oversized JSON before parsing', async () => {
    await expect(
      boundedJson(new Request('http://localhost', { method: 'POST', body: 'x'.repeat(33000) })),
    ).rejects.toThrow('too large');
  });
});
