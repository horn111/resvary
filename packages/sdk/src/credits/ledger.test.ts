import { describe, expect, it, vi } from 'vitest';
import { CreditLedger } from './ledger.js';
import {
  IdempotencyConflictError,
  InsufficientCreditsError,
  InvalidCreditStateError,
} from './errors.js';

async function createFixture(now = 1_000) {
  let currentTime = now;
  const ledger = new CreditLedger({
    projectId: 'project_ai',
    now: () => currentTime,
    reservationTtlMs: 100,
  });
  const meter = await ledger.registerMeter({
    key: 'tokens',
    dimensions: ['input_tokens', 'output_tokens'],
    idempotencyKey: 'meter-1',
  });
  const price = await ledger.createPriceVersion({
    meterKey: meter.key,
    idempotencyKey: 'price-1',
    rates: [
      { dimension: 'input_tokens', unitSize: '1000', amount: '0.002' },
      { dimension: 'output_tokens', unitSize: '1000', amount: '0.008' },
    ],
  });
  return {
    ledger,
    price,
    setNow: (value: number) => {
      currentTime = value;
    },
  };
}

describe('CreditLedger', () => {
  it('never records settlement before the funding transaction was accepted', async () => {
    const { ledger, setNow } = await createFixture(1_000);
    const intent = await ledger.createFundingIntent({
      customerId: 'cus_funding',
      amount: '1',
      rail: 'circle_gateway_nanopayment',
      network: 'eip155:5042002',
      invoiceId: 'gateway:test',
      idempotencyKey: 'funding-intent-1',
    });
    setNow(2_000);
    const result = await ledger.confirmFunding({
      fundingIntentId: intent.id,
      rail: 'circle_gateway_nanopayment',
      network: 'eip155:5042002',
      externalPaymentId: 'authorization-hash-1',
      amount: '1',
      paymentReceiptId: 'gateway:authorization-hash-1',
      settlementStatus: 'settled',
      settledAt: 1_500,
      requireExactAmount: true,
      idempotencyKey: 'funding-confirm-1',
    });

    expect(result.fundingTransaction.acceptedAt).toBe(2_000);
    expect(result.fundingTransaction.settledAt).toBe(2_000);
  });

  it('grants, reserves, commits actual usage, and releases the remainder atomically', async () => {
    const { ledger, price } = await createFixture();
    await ledger.grantCredits({ customerId: 'cus_1', amount: '5', idempotencyKey: 'grant-1' });
    const reservation = await ledger.reserveCredits({
      customerId: 'cus_1',
      priceId: price.id,
      estimatedUsage: { input_tokens: '2000', output_tokens: '1000' },
      idempotencyKey: 'reserve-1',
    });
    expect((await ledger.getBalance('cus_1')).reservedAmount).toBe('0.012');

    const result = await ledger.commitUsage({
      reservationId: reservation.id,
      usageEventId: 'provider_response_1',
      actualUsage: { input_tokens: '1000', output_tokens: '500' },
      idempotencyKey: 'commit-1',
    });
    expect(result.receipt.amount).toBe('0.006');
    expect(result.receipt.releasedAmount).toBe('0.006');
    expect(result.balance).toMatchObject({
      postedAmount: '4.994',
      reservedAmount: '0',
      availableAmount: '4.994',
    });
    expect((await ledger.listOutboxEvents()).map((event) => event.type)).toContain('usage.charged');
  });

  it('serializes concurrent reservations and never overdraws the account', async () => {
    const { ledger, price } = await createFixture();
    await ledger.grantCredits({ customerId: 'cus_1', amount: '0.012', idempotencyKey: 'grant-1' });
    const request = (key: string) =>
      ledger.reserveCredits({
        customerId: 'cus_1',
        priceId: price.id,
        estimatedUsage: { input_tokens: '2000', output_tokens: '1000' },
        idempotencyKey: key,
      });
    const results = await Promise.allSettled([request('reserve-a'), request('reserve-b')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect((await ledger.getBalance('cus_1')).availableUnits).toBe('0');
  });

  it('returns the original result for retries and rejects key reuse with another payload', async () => {
    const { ledger } = await createFixture();
    const first = await ledger.grantCredits({
      customerId: 'cus_1',
      amount: '1',
      idempotencyKey: 'grant-1',
    });
    const replay = await ledger.grantCredits({
      customerId: 'cus_1',
      amount: '1',
      idempotencyKey: 'grant-1',
    });
    expect(replay).toEqual(first);
    expect((await ledger.getBalance('cus_1')).postedAmount).toBe('1');
    await expect(
      ledger.grantCredits({ customerId: 'cus_1', amount: '2', idempotencyKey: 'grant-1' }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('releases a reservation when the provider fails', async () => {
    const { ledger, price } = await createFixture();
    await ledger.grantCredits({ customerId: 'cus_1', amount: '1', idempotencyKey: 'grant-1' });
    await expect(
      ledger.runMetered(
        {
          customerId: 'cus_1',
          priceId: price.id,
          estimatedUsage: { input_tokens: '1000', output_tokens: '1000' },
          idempotencyKey: 'run-1',
        },
        async () => {
          throw new Error('provider unavailable');
        },
      ),
    ).rejects.toThrow('provider unavailable');
    expect(await ledger.getBalance('cus_1')).toMatchObject({
      postedAmount: '1',
      reservedAmount: '0',
      availableAmount: '1',
    });
  });

  it('does not execute the provider twice after a completed run', async () => {
    const { ledger, price } = await createFixture();
    await ledger.grantCredits({ customerId: 'cus_1', amount: '1', idempotencyKey: 'grant-1' });
    const callback = vi.fn(async () => ({
      value: 'ok',
      usageEventId: 'usage-1',
      actualUsage: { input_tokens: '10', output_tokens: '5' },
    }));
    await ledger.runMetered(
      {
        customerId: 'cus_1',
        priceId: price.id,
        estimatedUsage: { input_tokens: '100', output_tokens: '100' },
        idempotencyKey: 'run-1',
      },
      callback,
    );
    const replay = await ledger.runMetered(
      {
        customerId: 'cus_1',
        priceId: price.id,
        estimatedUsage: { input_tokens: '100', output_tokens: '100' },
        idempotencyKey: 'run-1',
      },
      callback,
    );
    expect(callback).toHaveBeenCalledTimes(1);
    expect(replay.replayed).toBe(true);
    expect(replay.value).toBeUndefined();
  });

  it('expires open reservations and rejects charges above the reserved amount', async () => {
    const { ledger, price, setNow } = await createFixture();
    await ledger.grantCredits({ customerId: 'cus_1', amount: '1', idempotencyKey: 'grant-1' });
    const first = await ledger.reserveCredits({
      customerId: 'cus_1',
      priceId: price.id,
      estimatedUsage: { input_tokens: '10' },
      idempotencyKey: 'reserve-1',
    });
    await expect(
      ledger.commitUsage({
        reservationId: first.id,
        usageEventId: 'usage-too-large',
        actualUsage: { input_tokens: '1000' },
        idempotencyKey: 'commit-too-large',
      }),
    ).rejects.toBeInstanceOf(InvalidCreditStateError);
    setNow(1_101);
    await ledger.releaseExpiredReservations({ idempotencyKey: 'expire-1' });
    expect((await ledger.getReservation(first.id))?.status).toBe('expired');
    expect((await ledger.getBalance('cus_1')).reservedUnits).toBe('0');
  });
});
