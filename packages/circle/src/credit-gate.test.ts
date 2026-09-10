import { describe, expect, it } from 'vitest';
import { CreditLedger } from '@resvary/sdk/credits';
import { createGatewayCreditGate } from './credit-gate.js';
import { GatewayNanopaymentFunding } from './nanopayments.js';
import { ARC_GATEWAY_TESTNET } from './gateway.js';

describe('Gateway credit gate', () => {
  async function setup() {
    const ledger = new CreditLedger({ projectId: 'gate-test' });
    await ledger.ensureAccount({ customerId: 'buyer', idempotencyKey: 'account' });
    await ledger.registerMeter({ key: 'calls', dimensions: ['calls'], idempotencyKey: 'meter' });
    const price = await ledger.createPriceVersion({
      meterKey: 'calls',
      rates: [{ dimension: 'calls', amount: '0.015', unitSize: '1' }],
      idempotencyKey: 'price',
    });
    const funding = new GatewayNanopaymentFunding({
      ledger,
      sellerAddress: '0x1111111111111111111111111111111111111111',
      facilitator: {
        async getSupported() {
          return {
            kinds: [
              {
                x402Version: 2,
                scheme: 'exact',
                network: ARC_GATEWAY_TESTNET.network,
                extra: { verifyingContract: ARC_GATEWAY_TESTNET.gatewayWallet },
              },
            ],
            extensions: [],
            signers: {},
          };
        },
        async verify() {
          throw new Error('Not called');
        },
        async settle() {
          throw new Error('Not called');
        },
      },
    });
    const gate = createGatewayCreditGate({ ledger, funding });
    const input = {
      customerId: 'buyer',
      priceId: price.id,
      estimatedUsage: { calls: '1' },
      idempotencyKey: 'reserve',
      fundingIdempotencyKey: 'fund',
      expectedPayer: '0x2222222222222222222222222222222222222222' as const,
    };
    return { ledger, gate, input };
  }
  it('rounds only the shortfall up to a cent and binds customer/payer', async () => {
    const { ledger, gate, input } = await setup();
    await ledger.grantCredits({ customerId: 'buyer', amount: '0.011', idempotencyKey: 'seed' });
    const result = await gate(input);
    expect(result.status).toBe('payment_required');
    if (result.status !== 'payment_required') throw new Error('Missing challenge');
    expect(result.request.fundingIntent.requestedAmount).toBe('0.01');
    expect(result.request.fundingIntent.customerId).toBe('buyer');
    expect(JSON.stringify(result.request)).toContain(input.expectedPayer);
    expect((await ledger.getBalance('buyer')).availableAmount).toBe('0.011');
  });
  it('reserves without funding when credits are sufficient', async () => {
    const { ledger, gate, input } = await setup();
    await ledger.grantCredits({ customerId: 'buyer', amount: '0.02', idempotencyKey: 'seed' });
    expect((await gate(input)).status).toBe('reserved');
    expect((await ledger.getBalance('buyer')).availableAmount).toBe('0.005');
  });
  it('does not turn validation failures into payment challenges', async () => {
    const { gate, input } = await setup();
    await expect(gate({ ...input, priceId: 'missing' })).rejects.toThrow();
    await expect(gate({ ...input, expectedPayer: 'bad' as `0x${string}` })).rejects.toThrow(
      'payer',
    );
  });
});
