import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Runtime } from './runtime';

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: exec }));
vi.mock('./circle-session', () => ({
  withCircleSession: (operation: (env: NodeJS.ProcessEnv) => Promise<unknown>) =>
    operation({ NODE_ENV: 'test' }),
}));
import { paymentReadiness } from './circle-cli';

const wallet = `0x${'a1'.repeat(20)}`;
const payer = `0x${'b2'.repeat(20)}`;
const rt = { cfg: { testMode: false, wallet, payer } } as unknown as Runtime;

function responses(backingEOA = payer, listedWallet = wallet) {
  exec.mockImplementation((_executable, args, _options, callback) => {
    const data =
      args[2] === 'status'
        ? { testnet: { tokenStatus: 'VALID' } }
        : args[2] === 'list'
          ? { wallets: [{ address: listedWallet }] }
          : { total: '1', backingEOA };
    queueMicrotask(() => callback(null, JSON.stringify({ data }), ''));
  });
}

beforeEach(() => {
  exec.mockReset();
});
describe('Circle Agent Wallet identity', () => {
  it('uses the SCA for CLI commands and validates its distinct Gateway payer', async () => {
    responses();
    expect(await paymentReadiness(rt)).toMatchObject({ ready: true });
    const balanceArgs = exec.mock.calls.find((call) => call[1][1] === 'gateway')?.[1] as string[];
    expect(balanceArgs[balanceArgs.indexOf('--address') + 1]).toBe(wallet);
  });

  it('rejects a backing EOA that differs from the funding intent payer', async () => {
    responses(`0x${'c3'.repeat(20)}`);
    expect(await paymentReadiness(rt)).toMatchObject({
      ready: false,
      message: 'Gateway payer does not match the Agent Wallet backing EOA',
    });
  });

  it('rejects an Agent Wallet absent from the authenticated Testnet account', async () => {
    responses(payer, `0x${'d4'.repeat(20)}`);
    expect(await paymentReadiness(rt)).toMatchObject({ ready: false });
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
