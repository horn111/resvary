import { describe, expect, it } from 'vitest';
import { CreditLedger } from '@resvary/sdk/credits';
import {
  GatewayNanopaymentFunding,
  type GatewayFacilitator,
  type GatewayFundingRequest,
  type GatewayPaymentPayload,
} from './nanopayments.js';
import { ARC_GATEWAY_TESTNET } from './gateway.js';

const NOW = Date.UTC(2026, 7, 23);
const SELLER = '0x1111111111111111111111111111111111111111';
const PAYER = '0x2222222222222222222222222222222222222222';
const VERIFYING_CONTRACT = ARC_GATEWAY_TESTNET.gatewayWallet;
const SETTLEMENT = '0x' + 'ab'.repeat(32);

class FakeFacilitator implements GatewayFacilitator {
  verifyCalls = 0;
  settleCalls = 0;
  verifyValid = true;
  settleSuccess = true;
  supportedAvailable = true;

  async getSupported() {
    if (!this.supportedAvailable) throw new Error('facilitator unavailable');
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: 'exact',
          network: ARC_GATEWAY_TESTNET.network,
          extra: { verifyingContract: VERIFYING_CONTRACT },
        },
      ],
      extensions: [],
      signers: {},
    };
  }

  async verify() {
    this.verifyCalls += 1;
    return this.verifyValid
      ? { isValid: true, payer: PAYER }
      : { isValid: false, invalidReason: 'bad_signature' };
  }

  async settle() {
    this.settleCalls += 1;
    return this.settleSuccess
      ? {
          success: true,
          payer: PAYER,
          transaction: SETTLEMENT,
          network: ARC_GATEWAY_TESTNET.network,
          amount: '5000000',
        }
      : {
          success: false,
          errorReason: 'facilitator_rejected',
          transaction: '',
          network: ARC_GATEWAY_TESTNET.network,
        };
  }
}

function payloadFor(request: GatewayFundingRequest): GatewayPaymentPayload {
  return {
    x402Version: 2,
    accepted: structuredClone(request.paymentRequired.accepts[0]),
    payload: {
      signature: `0x${'cd'.repeat(65)}`,
      authorization: {
        from: PAYER,
        to: SELLER,
        value: request.fundingIntent.requestedUnits,
        validAfter: String(Math.floor(NOW / 1_000) - 60),
        validBefore: String(Math.floor(NOW / 1_000) + 8 * 24 * 60 * 60),
        nonce: `0x${'01'.repeat(32)}`,
      },
    },
    extensions: request.paymentRequired.extensions,
  };
}

async function fixture() {
  const ledger = new CreditLedger({ projectId: 'project_test', now: () => NOW });
  const facilitator = new FakeFacilitator();
  const funding = new GatewayNanopaymentFunding({
    ledger,
    sellerAddress: SELLER,
    facilitator,
    now: () => NOW,
  });
  const request = await funding.createFundingRequest({
    customerId: 'customer_1',
    amount: '5',
    expectedPayer: PAYER,
    idempotencyKey: 'create_1',
  });
  return { ledger, facilitator, funding, request, payload: payloadFor(request) };
}

describe('GatewayNanopaymentFunding', () => {
  it('verifies, settles, and grants exact credits once', async () => {
    const { facilitator, funding, request, payload } = await fixture();
    const first = await funding.verifySettleAndCredit({
      fundingIntentId: request.fundingIntent.id,
      paymentPayload: payload,
      idempotencyKey: 'settle_1',
    });
    facilitator.supportedAvailable = false;
    const replay = await funding.verifySettleAndCredit({
      fundingIntentId: request.fundingIntent.id,
      paymentPayload: payload,
      idempotencyKey: 'settle_replay',
    });

    expect(first.replayed).toBe(false);
    expect(first.account.availableAmount).toBe('5');
    expect(first.fundingTransaction.rail).toBe('circle_gateway_nanopayment');
    expect(first.fundingTransaction.settlementStatus).toBe('settled');
    expect(first.fundingTransaction.evidence?.authorizationHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(replay.replayed).toBe(true);
    expect(replay.grant.id).toBe(first.grant.id);
    expect(facilitator.verifyCalls).toBe(1);
    expect(facilitator.settleCalls).toBe(1);
  });

  it('rejects an amount that differs by one atomic unit', async () => {
    const { funding, request, payload } = await fixture();
    payload.accepted.amount = '5000001';
    payload.payload.authorization!.value = '5000001';

    await expect(
      funding.verifySettleAndCredit({
        fundingIntentId: request.fundingIntent.id,
        paymentPayload: payload,
        idempotencyKey: 'wrong_amount',
      }),
    ).rejects.toThrow('amount mismatch');
  });

  it.each([
    ['scheme', (payload: GatewayPaymentPayload) => (payload.accepted.scheme = 'other'), 'scheme'],
    [
      'network',
      (payload: GatewayPaymentPayload) => (payload.accepted.network = 'eip155:1'),
      'network',
    ],
    [
      'requirements recipient',
      (payload: GatewayPaymentPayload) =>
        (payload.accepted.payTo = '0x3333333333333333333333333333333333333333'),
      'recipient',
    ],
    [
      'authorization recipient',
      (payload: GatewayPaymentPayload) =>
        (payload.payload.authorization!.to = '0x3333333333333333333333333333333333333333'),
      'authorization recipient',
    ],
    [
      'nonce',
      (payload: GatewayPaymentPayload) => (payload.payload.authorization!.nonce = '0x01'),
      'nonce',
    ],
  ])('rejects an invalid %s before facilitator verification', async (_name, mutate, message) => {
    const { facilitator, funding, request, payload } = await fixture();
    mutate(payload);

    await expect(
      funding.verifySettleAndCredit({
        fundingIntentId: request.fundingIntent.id,
        paymentPayload: payload,
        idempotencyKey: `invalid_${_name}`,
      }),
    ).rejects.toThrow(message);
    expect(facilitator.verifyCalls).toBe(0);
    expect(facilitator.settleCalls).toBe(0);
  });

  it('does not grant credits when facilitator verification rejects the signature', async () => {
    const { ledger, facilitator, funding, request, payload } = await fixture();
    facilitator.verifyValid = false;

    await expect(
      funding.verifySettleAndCredit({
        fundingIntentId: request.fundingIntent.id,
        paymentPayload: payload,
        idempotencyKey: 'bad_signature',
      }),
    ).rejects.toThrow('verification failed');
    const account = await ledger.store.getAccount(request.fundingIntent.accountId);
    expect(account?.availableAmount).toBe('0');
    expect(facilitator.settleCalls).toBe(0);
  });

  it('serializes two workers settling the same authorization into one grant', async () => {
    const { ledger, funding, request, payload } = await fixture();
    const [first, second] = await Promise.all([
      funding.verifySettleAndCredit({
        fundingIntentId: request.fundingIntent.id,
        paymentPayload: payload,
        idempotencyKey: 'parallel_1',
      }),
      funding.verifySettleAndCredit({
        fundingIntentId: request.fundingIntent.id,
        paymentPayload: structuredClone(payload),
        idempotencyKey: 'parallel_2',
      }),
    ]);

    expect(first.grant.id).toBe(second.grant.id);
    expect((await ledger.store.getAccount(request.fundingIntent.accountId))?.availableAmount).toBe(
      '5',
    );
    expect(await ledger.listFundingTransactions()).toHaveLength(1);
  });

  it('rejects expired authorizations before calling the facilitator', async () => {
    const { facilitator, funding, request, payload } = await fixture();
    payload.payload.authorization!.validBefore = String(Math.floor(NOW / 1_000));

    await expect(
      funding.verifySettleAndCredit({
        fundingIntentId: request.fundingIntent.id,
        paymentPayload: payload,
        idempotencyKey: 'expired',
      }),
    ).rejects.toThrow('expired');
    expect(facilitator.verifyCalls).toBe(0);
  });

  it('does not grant credits when facilitator settlement fails', async () => {
    const { ledger, facilitator, funding, request, payload } = await fixture();
    facilitator.settleSuccess = false;

    await expect(
      funding.verifySettleAndCredit({
        fundingIntentId: request.fundingIntent.id,
        paymentPayload: payload,
        idempotencyKey: 'rejected',
      }),
    ).rejects.toThrow('settlement failed');
    const account = await ledger.store.getAccount(request.fundingIntent.accountId);
    expect(account?.availableAmount).toBe('0');
  });

  it('records a later Gateway dispute without reversing credits', async () => {
    const { funding, request, payload } = await fixture();
    const credited = await funding.verifySettleAndCredit({
      fundingIntentId: request.fundingIntent.id,
      paymentPayload: payload,
      idempotencyKey: 'settle_2',
    });
    const flagged = await funding.markReconciliationRequired(
      credited.fundingTransaction.id,
      'Gateway reported a later settlement problem',
      'reconcile_1',
    );

    expect(flagged.settlementStatus).toBe('reconciliation_required');
    expect(credited.account.availableAmount).toBe('5');
  });
});
