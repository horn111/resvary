import { describe, expect, it } from 'vitest';
import { CreditLedger } from '@resvary/sdk/credits';
import { createGatewayTopUpHandler } from './handlers.js';
import {
  GatewayNanopaymentFunding,
  type GatewayFacilitator,
  type GatewayPaymentPayload,
} from './nanopayments.js';
import { ARC_GATEWAY_TESTNET } from './gateway.js';

const NOW = Date.UTC(2026, 7, 23);
const SELLER = '0x1111111111111111111111111111111111111111';
const PAYER = '0x2222222222222222222222222222222222222222';

const facilitator: GatewayFacilitator = {
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
    return { isValid: true, payer: PAYER };
  },
  async settle(_payload, requirements) {
    return {
      success: true,
      payer: PAYER,
      transaction: `0x${'ab'.repeat(32)}`,
      network: ARC_GATEWAY_TESTNET.network,
      amount: requirements.amount,
    };
  },
};

describe('createGatewayTopUpHandler', () => {
  it('rejects every request while the live route is disabled', async () => {
    let resolved = false;
    const ledger = new CreditLedger({ projectId: 'handler_disabled', now: () => NOW });
    const handler = createGatewayTopUpHandler({
      funding: new GatewayNanopaymentFunding({
        ledger,
        sellerAddress: SELLER,
        facilitator,
        now: () => NOW,
      }),
      enabled: false,
      disabledMessage: 'Proof route is disabled',
      resolveRequest: () => {
        resolved = true;
        return {
          customerId: 'customer_1',
          amount: '3',
          idempotencyKey: 'disabled_intent',
        };
      },
    });

    const response = await handler(new Request('https://example.test/top-up'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Proof route is disabled' });
    expect(resolved).toBe(false);
    expect(await ledger.listFundingIntents()).toHaveLength(0);
  });

  it('returns a private 400 response when the unpaid request is invalid', async () => {
    const ledger = new CreditLedger({ projectId: 'handler_invalid', now: () => NOW });
    const handler = createGatewayTopUpHandler({
      funding: new GatewayNanopaymentFunding({
        ledger,
        sellerAddress: SELLER,
        facilitator,
        now: () => NOW,
      }),
      resolveRequest: () => {
        throw new Error('proofId is invalid');
      },
    });

    const response = await handler(new Request('https://example.test/top-up'));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'proofId is invalid' });
    expect(await ledger.listFundingIntents()).toHaveLength(0);
  });

  it('serves an x402 challenge, settles the paid retry, and replays safely', async () => {
    const ledger = new CreditLedger({ projectId: 'handler_test', now: () => NOW });
    const funding = new GatewayNanopaymentFunding({
      ledger,
      sellerAddress: SELLER,
      facilitator,
      now: () => NOW,
    });
    const handler = createGatewayTopUpHandler({
      funding,
      resolveRequest: () => ({
        customerId: 'customer_1',
        amount: '3',
        expectedPayer: PAYER,
        idempotencyKey: 'handler_intent_1',
      }),
    });

    const challenge = await handler(
      new Request('https://example.test/top-up', {
        method: 'POST',
      }),
    );
    expect(challenge.status).toBe(402);
    const paymentRequired = JSON.parse(
      Buffer.from(challenge.headers.get('payment-required')!, 'base64').toString('utf8'),
    );
    const accepted = paymentRequired.accepts[0];
    const payload: GatewayPaymentPayload = {
      x402Version: 2,
      accepted,
      payload: {
        signature: `0x${'cd'.repeat(65)}`,
        authorization: {
          from: PAYER,
          to: SELLER,
          value: accepted.amount,
          validAfter: String(Math.floor(NOW / 1_000) - 60),
          validBefore: String(Math.floor(NOW / 1_000) + 8 * 24 * 60 * 60),
          nonce: `0x${'01'.repeat(32)}`,
        },
      },
    };
    const paidRequest = () =>
      new Request('https://example.test/top-up', {
        method: 'POST',
        headers: {
          'payment-signature': Buffer.from(JSON.stringify(payload)).toString('base64'),
        },
      });

    const paid = await handler(paidRequest());
    const first = (await paid.json()) as {
      replayed: boolean;
      balance: { availableAmount: string };
    };
    expect(paid.status).toBe(200);
    expect(paid.headers.get('payment-response')).toBeTruthy();
    expect(first.replayed).toBe(false);
    expect(first.balance.availableAmount).toBe('3');

    const replay = await handler(paidRequest());
    const second = (await replay.json()) as { replayed: boolean; grant: { id: string } };
    expect(replay.status).toBe(200);
    expect(second.replayed).toBe(true);
    expect(await ledger.listFundingTransactions()).toHaveLength(1);
  });
});
