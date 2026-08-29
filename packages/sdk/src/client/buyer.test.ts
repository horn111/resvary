import { describe, expect, it } from 'vitest';
import type { PaymentRequirements } from '../types.js';
import { BuyerClient, type BuyerPaymentPolicy } from './buyer.js';

const privateKey = `0x${'11'.repeat(32)}` as const;
const seller = '0x1111111111111111111111111111111111111111' as const;
const otherSeller = '0x2222222222222222222222222222222222222222' as const;

function requirements(amount: string, payTo = seller) {
  return {
    x402Version: 2,
    scheme: 'exact',
    network: 'arc-testnet',
    maxAmountRequired: amount,
    payTo,
  } as const;
}

function paymentResponse(value: PaymentRequirements) {
  return new Response(null, {
    status: 402,
    headers: {
      'x-payment-requirements': Buffer.from(JSON.stringify(value)).toString('base64'),
    },
  });
}

function policy(overrides: Partial<BuyerPaymentPolicy> = {}): BuyerPaymentPolicy {
  return {
    maxAmount: '1',
    maxTotalAmount: '2',
    allowedPayTo: [seller],
    ...overrides,
  };
}

describe('BuyerClient payment policy', () => {
  it('fails closed when no payment policy is configured', async () => {
    const client = new BuyerClient({
      privateKey,
      fetch: async () => paymentResponse(requirements('0.1')),
    });

    await expect(client.request('https://api.example.com/data')).rejects.toThrow(
      'paymentPolicy is required',
    );
  });

  it.each([
    [requirements('1.01'), 'per-request'],
    [requirements('0.1', otherSeller), 'recipient'],
    [requirements('1e-3'), 'Invalid stablecoin amount'],
  ])('rejects unapproved requirements %#', async (value, message) => {
    const client = new BuyerClient({
      privateKey,
      paymentPolicy: policy(),
      fetch: async () => paymentResponse(value),
    });

    await expect(client.request('https://api.example.com/data')).rejects.toThrow(message);
  });

  it('rejects expired payment requirements', async () => {
    const client = new BuyerClient({
      privateKey,
      paymentPolicy: policy(),
      fetch: async () => paymentResponse({ ...requirements('0.1'), expiry: 1 }),
    });

    await expect(client.request('https://api.example.com/data')).rejects.toThrow('expired');
  });

  it('signs exact bounded units and enforces the client total budget', async () => {
    const responses = [
      paymentResponse(requirements('0.75')),
      Response.json({ ok: true }),
      paymentResponse(requirements('0.75')),
      Response.json({ ok: true }),
      paymentResponse(requirements('0.75')),
    ];
    const client = new BuyerClient({
      privateKey,
      paymentPolicy: policy({ maxTotalAmount: '1.5' }),
      fetch: async () => responses.shift()!,
    });

    await expect(client.request('https://api.example.com/data')).resolves.toMatchObject({
      payment: { amount: '0.75', to: seller },
    });
    await expect(client.request('https://api.example.com/data')).resolves.toMatchObject({
      payment: { amount: '0.75', to: seller },
    });
    await expect(client.request('https://api.example.com/data')).rejects.toThrow('total policy');
  });

  it('reserves the total budget while an asynchronous approval is pending', async () => {
    let releaseApproval!: (approved: boolean) => void;
    const approval = new Promise<boolean>((resolve) => {
      releaseApproval = resolve;
    });
    const client = new BuyerClient({
      privateKey,
      paymentPolicy: policy({
        maxTotalAmount: '1',
        approve: async () => approval,
      }),
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers);
        return headers.has('x-payment')
          ? Response.json({ ok: true })
          : paymentResponse(requirements('0.75'));
      },
    });

    const first = client.request('https://api.example.com/first');
    await Promise.resolve();
    const second = client.request('https://api.example.com/second');

    await expect(second).rejects.toThrow('total policy');
    releaseApproval(true);
    await expect(first).resolves.toMatchObject({ payment: { amount: '0.75', to: seller } });
  });

  it('releases a reserved budget when the application denies approval', async () => {
    let approvalCount = 0;
    const client = new BuyerClient({
      privateKey,
      paymentPolicy: policy({
        maxTotalAmount: '0.75',
        approve: async () => ++approvalCount > 1,
      }),
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers);
        return headers.has('x-payment')
          ? Response.json({ ok: true })
          : paymentResponse(requirements('0.75'));
      },
    });

    await expect(client.request('https://api.example.com/denied')).rejects.toThrow(
      'application approval policy',
    );
    await expect(client.request('https://api.example.com/approved')).resolves.toMatchObject({
      payment: { amount: '0.75', to: seller },
    });
  });
});
