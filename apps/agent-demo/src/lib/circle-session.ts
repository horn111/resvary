import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';

const VERSION = 'resvary-circle-testnet-v1';
const AAD = Buffer.from(VERSION, 'utf8');
const secretField = z.string().min(1).max(16_384);
const sessionSchema = z
  .object({
    email: z.string().min(1).max(320),
    testnet: z
      .object({
        userToken: secretField,
        encryptionKey: secretField,
        encryptedUserSecret: secretField,
        storageKey: secretField,
        deviceId: z.string().min(1).max(256),
        expiresAt: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
const termsSchema = z
  .object({
    accepted: z.literal(true),
    version: z.literal('1'),
    acceptedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
    acceptedVia: z.string().min(1).max(32).optional(),
  })
  .strict();
const bundleSchema = z
  .object({
    version: z.literal(VERSION),
    cliVersion: z.literal('1.0.0'),
    session: sessionSchema,
    terms: termsSchema,
  })
  .strict();
type Bundle = z.infer<typeof bundleSchema>;

function keyBytes(key: string) {
  if (!/^[\da-f]{64}$/i.test(key))
    throw new Error('Circle session encryption key must be 32 bytes of hex');
  return Buffer.from(key, 'hex');
}

function validateBundle(value: unknown): Bundle {
  const parsed = bundleSchema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid Circle Testnet session bundle');
  if (parsed.data.session.testnet.expiresAt <= Date.now() + 120_000)
    throw new Error(
      'Circle Testnet session expires soon or has expired; log in and export it again',
    );
  return parsed.data;
}

/** Select only the Testnet Agent Wallet slot. Never copy mainnet, local keys, or RPC overrides. */
export function exportCircleSession(session: unknown, terms: unknown, encryptionKey: string) {
  const source = session as { email?: unknown; testnet?: Record<string, unknown> } | null;
  const slot = source?.testnet;
  if (!slot || !slot.userToken)
    throw new Error(
      'No portable Testnet session found; log in with the pinned CLI on this machine first',
    );
  const bundle = validateBundle({
    version: VERSION,
    cliVersion: '1.0.0',
    session: {
      email: source.email,
      testnet: {
        userToken: slot.userToken,
        encryptionKey: slot.encryptionKey,
        encryptedUserSecret: slot.encryptedUserSecret,
        storageKey: slot.storageKey,
        deviceId: slot.deviceId,
        expiresAt: slot.expiresAt,
      },
    },
    terms,
  });
  const plaintext = Buffer.from(JSON.stringify(bundle), 'utf8');
  if (plaintext.byteLength > 32_768) throw new Error('Circle session bundle is too large');
  const nonce = randomBytes(12);
  const key = keyBytes(encryptionKey);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      encrypted: [
        'v1',
        nonce.toString('base64url'),
        ciphertext.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
      ].join('.'),
      expiresAt: bundle.session.testnet.expiresAt,
    };
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

function openCircleSession(encrypted: string, encryptionKey: string): Bundle {
  if (encrypted.length > 45_000) throw new Error('Circle session bundle is too large');
  const parts = encrypted.split('.');
  if (
    parts.length !== 4 ||
    parts[0] !== 'v1' ||
    parts.slice(1).some((part) => !/^[\w-]+$/.test(part))
  )
    throw new Error('Invalid encrypted Circle session bundle');
  const nonce = Buffer.from(parts[1], 'base64url');
  const ciphertext = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  if (nonce.length !== 12 || tag.length !== 16)
    throw new Error('Invalid encrypted Circle session bundle');
  const key = keyBytes(encryptionKey);
  let plaintext: Buffer | undefined;
  let decoded: unknown;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    decoded = JSON.parse(plaintext.toString('utf8'));
  } catch {
    // Crypto and JSON errors must never include credentials or serialized input.
    throw new Error('Circle session bundle could not be authenticated');
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
  return validateBundle(decoded);
}

/** Pass only platform necessities to the CLI. In particular, no AI/DB keys or proxy overrides. */
export function circleChildEnv(source: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { NO_COLOR: '1', NODE_ENV: 'production' };
  for (const name of [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
  ]) {
    if (source[name] !== undefined) result[name] = source[name];
  }
  return result;
}

/** A fresh, private home for each child process, including concurrent invocations. */
export async function withCircleSession<T>(
  operation: (env: NodeJS.ProcessEnv) => Promise<T>,
  source: Record<string, string | undefined> = process.env,
): Promise<T> {
  const encrypted = source.CIRCLE_AGENT_SESSION_BUNDLE;
  const encryptionKey = source.CIRCLE_SESSION_ENCRYPTION_KEY;
  const env = circleChildEnv(source);
  if (!encrypted && !encryptionKey) {
    if (source.VERCEL)
      throw new Error('Circle Testnet session bundle is not configured for Vercel');
    if (source.CIRCLE_CLI_HOME) env.CIRCLE_CLI_HOME = source.CIRCLE_CLI_HOME;
    return operation(env);
  }
  if (!encrypted || !encryptionKey)
    throw new Error('Both Circle session bundle variables are required');
  const bundle = openCircleSession(encrypted, encryptionKey);
  const tempRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(tempRoot, 'resvary-circle-'));
  try {
    await chmod(directory, 0o700);
    const profile = join(directory, 'profiles', 'agent');
    await mkdir(profile, { recursive: true, mode: 0o700 });
    await writeFile(join(profile, 'session.json'), JSON.stringify(bundle.session), {
      mode: 0o600,
      flag: 'wx',
    });
    await writeFile(join(directory, 'terms.json'), JSON.stringify(bundle.terms), {
      mode: 0o600,
      flag: 'wx',
    });
    await writeFile(
      join(directory, 'config.json'),
      JSON.stringify({ telemetry: { enabled: false } }),
      { mode: 0o600, flag: 'wx' },
    );
    // Pinned CLI 1.0.0 reads this session during payment. It never refreshes or
    // rewrites it; a new operator login/export is needed when its token expires.
    return await operation({ ...env, CIRCLE_CLI_HOME: directory });
  } finally {
    if (dirname(directory) === tempRoot && basename(directory).startsWith('resvary-circle-')) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
