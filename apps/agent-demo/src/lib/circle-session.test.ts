import { execFile } from 'node:child_process';
import { access, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { circleChildEnv, exportCircleSession, withCircleSession } from './circle-session';

const encryptionKey = 'e3'.repeat(32);
const terms = {
  accepted: true,
  version: '1',
  acceptedAt: '2026-09-01T00:00:00.000Z',
  acceptedVia: 'prompt',
};
function session() {
  return {
    email: 'fixture@example.invalid',
    testnet: {
      userToken: 'fixture-user-token',
      encryptionKey: 'fixture-encryption-key',
      encryptedUserSecret: 'fixture-encrypted-user-secret',
      storageKey: 'fixture-storage-key',
      deviceId: 'fixture-device-id',
      expiresAt: Date.now() + 3_600_000,
      refreshToken: 'must-not-export-refresh-token',
    },
    mainnet: { userToken: 'must-not-export-mainnet-token' },
  };
}
function configuredEnv() {
  return {
    ...process.env,
    VERCEL: '1',
    CIRCLE_AGENT_SESSION_BUNDLE: exportCircleSession(session(), terms, encryptionKey).encrypted,
    CIRCLE_SESSION_ENCRYPTION_KEY: encryptionKey,
  };
}
afterEach(() => vi.restoreAllMocks());

describe('portable Circle Testnet session', () => {
  it('hydrates only Testnet secrets, keeps homes isolated under concurrency, and cleans them', async () => {
    const environments = configuredEnv();
    const homes: string[] = [];
    let bothEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    await Promise.all(
      [1, 2].map(() =>
        withCircleSession(async (env) => {
          const directory = env.CIRCLE_CLI_HOME!;
          homes.push(directory);
          if (homes.length === 2) bothEntered();
          await entered;
          const raw = await readFile(join(directory, 'profiles', 'agent', 'session.json'), 'utf8');
          expect(raw).toContain('fixture-user-token');
          expect(raw).not.toContain('mainnet');
          expect(raw).not.toContain('refreshToken');
          expect(JSON.parse(await readFile(join(directory, 'terms.json'), 'utf8'))).toEqual(terms);
          if (process.platform !== 'win32') {
            expect((await stat(directory)).mode & 0o777).toBe(0o700);
            expect(
              (await stat(join(directory, 'profiles', 'agent', 'session.json'))).mode & 0o777,
            ).toBe(0o600);
          }
          expect(env.CIRCLE_AGENT_SESSION_BUNDLE).toBeUndefined();
          expect(env.CIRCLE_SESSION_ENCRYPTION_KEY).toBeUndefined();
        }, environments),
      ),
    );
    expect(new Set(homes).size).toBe(2);
    for (const directory of homes) await expect(access(directory)).rejects.toThrow();
  });

  it('removes plaintext after a failed command', async () => {
    let directory = '';
    await expect(
      withCircleSession(async (env) => {
        directory = env.CIRCLE_CLI_HOME!;
        throw new Error('command failed');
      }, configuredEnv()),
    ).rejects.toThrow('command failed');
    await expect(access(directory)).rejects.toThrow();
  });

  it('rejects tampered ciphertext and wrong keys before running the CLI', async () => {
    const operation = vi.fn();
    const env = configuredEnv();
    const parts = env.CIRCLE_AGENT_SESSION_BUNDLE.split('.');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    ciphertext[0] ^= 1;
    parts[2] = ciphertext.toString('base64url');
    await expect(
      withCircleSession(operation, { ...env, CIRCLE_AGENT_SESSION_BUNDLE: parts.join('.') }),
    ).rejects.toThrow('could not be authenticated');
    await expect(
      withCircleSession(operation, { ...env, CIRCLE_SESSION_ENCRYPTION_KEY: 'a1'.repeat(32) }),
    ).rejects.toThrow('could not be authenticated');
    expect(operation).not.toHaveBeenCalled();
  });

  it('does not execute with expired or missing Vercel credentials', async () => {
    const env = configuredEnv();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_700_000);
    const operation = vi.fn();
    await expect(withCircleSession(operation, env)).rejects.toThrow('expired');
    await expect(withCircleSession(operation, { VERCEL: '1' })).rejects.toThrow('not configured');
    await expect(
      withCircleSession(operation, { VERCEL: '1', CIRCLE_SESSION_ENCRYPTION_KEY: encryptionKey }),
    ).rejects.toThrow('Both Circle');
    expect(operation).not.toHaveBeenCalled();
  });

  it('requires prior Terms acceptance and a full session rather than keychain metadata', () => {
    expect(() =>
      exportCircleSession(session(), { ...terms, accepted: false }, encryptionKey),
    ).toThrow('Invalid Circle');
    expect(() =>
      exportCircleSession(
        { email: 'fixture@example.invalid', testnet: { expiresAt: Date.now() + 3_600_000 } },
        terms,
        encryptionKey,
      ),
    ).toThrow('No portable Testnet session');
  });

  it('does not inherit provider keys, Node injections, or Circle endpoint overrides', () => {
    const env = circleChildEnv({
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'private',
      DATABASE_URL: 'private',
      CIRCLE_PROXY_URL: 'https://untrusted.invalid',
      CIRCLE_DEBUG: '1',
      NODE_OPTIONS: '--inspect',
      CIRCLE_ACCEPT_TERMS: '1',
    });
    expect(env).toEqual({ NO_COLOR: '1', NODE_ENV: 'production', PATH: '/usr/bin' });
  });

  it('the pinned CLI reads the hydrated fixture session without an OS keychain or network call', async () => {
    const require = createRequire(import.meta.url);
    const cli = require.resolve('@circle-fin/cli');
    await withCircleSession(async (env) => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [cli, 'wallet', 'status', '--type', 'agent', '--output', 'json'],
        {
          env: { ...env, CIRCLE_VERSION_CHECK: 'off' },
          timeout: 20_000,
          windowsHide: true,
        },
      );
      const response = JSON.parse(stdout);
      expect(response.data.testnet.tokenStatus).toBe('VALID');
      expect(response.data.mainnet.tokenStatus).toBe('NOT_LOGGED_IN');
    }, configuredEnv());
  }, 25_000);
});
