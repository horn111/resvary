import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { ARC_GATEWAY_TESTNET, type GatewayPaymentPayload } from '@resvary/circle';
import { funding } from './payments';
import type { Runtime } from './runtime';
import { paymentToken } from './auth';
import type { Job } from './store';
import { withCircleSession } from './circle-session';

export function circle(args: string[]): Promise<unknown> {
  // Resolve at runtime: this is a child-process executable, not an ESM import.
  // next.config.ts traces its complete dependency tree separately for Vercel.
  const executable = process
    .getBuiltinModule('node:module')
    .createRequire(resolve(process.cwd(), 'package.json'))
    .resolve('@circle-fin/cli');
  return withCircleSession(
    (env) =>
      new Promise((ok, fail) =>
        execFile(
          process.execPath,
          [executable, ...args, '--output', 'json'],
          {
            timeout: 90_000,
            maxBuffer: 256_000,
            windowsHide: true,
            // No caller-controlled executable, shell, environment, or redirection.
            env,
          },
          (error, stdout) => {
            if (error)
              return fail(
                new Error('Circle command failed or timed out. Check the private wallet session.'),
              );
            try {
              const response = JSON.parse(stdout);
              if (!response || typeof response !== 'object' || !('data' in response))
                throw new Error('Missing data envelope');
              ok(response.data);
            } catch {
              fail(new Error('Circle returned an unrecognized response'));
            }
          },
        ),
      ),
  );
}

export async function pay(rt: Runtime, job: Job) {
  if (!job.challenge) throw new Error('Missing persisted challenge');
  const requirements = job.challenge.paymentRequired.accepts[0];
  if (
    requirements.network !== ARC_GATEWAY_TESTNET.network ||
    requirements.payTo.toLowerCase() !== rt.cfg.seller ||
    BigInt(requirements.amount) > 50_000n
  )
    throw new Error('Payment exceeds demo policy');
  if (rt.cfg.testMode) {
    const now = Math.floor(Date.now() / 1000);
    const payload: GatewayPaymentPayload = {
      x402Version: 2,
      accepted: requirements,
      payload: {
        signature: 'TEST_FIXTURE',
        authorization: {
          from: rt.cfg.payer,
          to: rt.cfg.seller,
          value: requirements.amount,
          validAfter: String(now - 60),
          validBefore: String(now + 604_800),
          nonce: `0x${createHash('sha256').update(job.id).digest('hex')}`,
        },
      },
    };
    return funding(rt, job.id).verifySettleAndCredit({
      fundingIntentId: job.challenge.fundingIntent.id,
      paymentPayload: payload,
      idempotencyKey: `payment:${job.id}`,
    });
  }
  // The return payload is deliberately not logged or persisted: it can contain auth details.
  await circle([
    'services',
    'pay',
    `${rt.cfg.origin}/api/internal/topup/${job.id}`,
    '--address',
    rt.cfg.wallet,
    '--chain',
    'ARC-TESTNET',
    '--max-amount',
    job.challenge.fundingIntent.requestedAmount,
    '--method',
    'POST',
    '--header',
    `Authorization: Bearer ${paymentToken(job.id, rt.cfg.secret)}`,
    '--timeout',
    '30',
  ]);
}

export async function paymentReadiness(rt: Runtime) {
  if (rt.cfg.testMode)
    return { ready: true, message: 'Local test fixtures; no external payment or AI call' };
  try {
    const status = (await circle(['wallet', 'status', '--type', 'agent'])) as {
      testnet?: { tokenStatus?: string };
    };
    const wallets = (await circle([
      'wallet',
      'list',
      '--chain',
      'ARC-TESTNET',
      '--type',
      'agent',
    ])) as { wallets?: { address?: string }[] };
    // The CLI takes the Agent Wallet SCA, but Gateway authorizations use its backing EOA.
    if (
      status?.testnet?.tokenStatus !== 'VALID' ||
      !wallets.wallets?.some((wallet) => wallet.address?.toLowerCase() === rt.cfg.wallet)
    )
      return { ready: false, message: 'Configured Agent Wallet or Testnet session is unavailable' };
    const balance = (await circle([
      'gateway',
      'balance',
      '--address',
      rt.cfg.wallet,
      '--chain',
      'ARC-TESTNET',
    ])) as { total?: string; backingEOA?: string };
    if (balance.backingEOA?.toLowerCase() !== rt.cfg.payer)
      return { ready: false, message: 'Gateway payer does not match the Agent Wallet backing EOA' };
    const ready =
      typeof balance.total === 'string' &&
      /^\d+(\.\d+)?$/.test(balance.total) &&
      Number(balance.total) >= 0.05;
    return {
      ready,
      message: ready
        ? 'Circle session and Gateway funds checked'
        : 'Gateway needs at least 0.05 Testnet USDC',
    };
  } catch {
    return {
      ready: false,
      message: 'Circle session or Gateway is unavailable; operator login may be required',
    };
  }
}
