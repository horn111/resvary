import { describe, expect, it, vi } from 'vitest';
import { CreditLedger } from './ledger.js';
import { InMemoryCreditStore, type CreditStore } from './store.js';
import {
  IdempotencyConflictError,
  InsufficientCreditsError,
  InvalidCreditStateError,
  UnsupportedCreditStoreCapabilityError,
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
  it('derives allowance periods from UTC day, Monday week, and month boundaries', async () => {
    const fixture = await createFixture(Date.UTC(2026, 0, 4, 23, 59, 59));
    const policies = await Promise.all(
      (['day', 'week', 'month'] as const).map((cadence) =>
        fixture.ledger.createGrantPolicy({
          type: 'allowance',
          key: cadence,
          cadence,
          amount: '1',
          idempotencyKey: `policy-${cadence}`,
        }),
      ),
    );
    const first = await Promise.all(
      policies.map((policy) =>
        fixture.ledger.applyAllowance({
          policyId: policy.id,
          customerId: `customer-${policy.key}`,
          idempotencyKey: `first-${policy.key}`,
        }),
      ),
    );
    expect(first.map((result) => result.application.periodKey)).toEqual([
      'day:2026-01-04',
      'week:2025-12-29',
      'month:2026-01',
    ]);

    fixture.setNow(Date.UTC(2026, 0, 5, 0, 0, 0));
    const next = await Promise.all(
      policies.map((policy) =>
        fixture.ledger.applyAllowance({
          policyId: policy.id,
          customerId: `customer-${policy.key}`,
          idempotencyKey: `next-${policy.key}`,
        }),
      ),
    );
    expect(next.map((result) => result.application.periodKey)).toEqual([
      'day:2026-01-05',
      'week:2026-01-05',
      'month:2026-01',
    ]);
    expect(next[2]?.application.id).toBe(first[2]?.application.id);
    expect(await fixture.ledger.listGrantPolicyApplications('customer-month')).toHaveLength(1);
  });

  it('tops an allowance up to its target once per period without accumulating', async () => {
    const { ledger, setNow } = await createFixture(Date.UTC(2026, 0, 1));
    const policy = await ledger.createGrantPolicy({
      type: 'allowance',
      key: 'monthly',
      cadence: 'month',
      amount: '10',
      idempotencyKey: 'monthly-policy',
    });
    await ledger.applyAllowance({
      policyId: policy.id,
      customerId: 'allowance-customer',
      idempotencyKey: 'january',
    });
    await ledger.adjustCredits({
      customerId: 'allowance-customer',
      amount: '-4',
      reason: 'usage correction',
      idempotencyKey: 'spend-four',
    });
    const replayedPeriod = await ledger.applyAllowance({
      policyId: policy.id,
      customerId: 'allowance-customer',
      idempotencyKey: 'january-other-key',
    });
    expect(replayedPeriod.grant?.id).toBeDefined();
    expect(replayedPeriod.account.postedAmount).toBe('6');
    expect(await ledger.listGrantPolicyApplications('allowance-customer')).toHaveLength(1);

    setNow(Date.UTC(2026, 1, 1));
    const february = await ledger.applyAllowance({
      policyId: policy.id,
      customerId: 'allowance-customer',
      idempotencyKey: 'february',
    });
    expect(february.grant?.amount).toBe('4');
    expect(february.account.postedAmount).toBe('10');
    setNow(Date.UTC(2026, 2, 1));
    const march = await ledger.applyAllowance({
      policyId: policy.id,
      customerId: 'allowance-customer',
      idempotencyKey: 'march',
    });
    expect(march.grant).toBeUndefined();
    expect(march.account.postedAmount).toBe('10');
  });

  it('serializes allowance applications and permits one promotion claim per policy version', async () => {
    const { ledger } = await createFixture();
    const allowance = await ledger.createGrantPolicy({
      type: 'allowance',
      key: 'daily',
      cadence: 'day',
      amount: '2',
      idempotencyKey: 'daily-policy',
    });
    const concurrent = await Promise.all([
      ledger.applyAllowance({
        policyId: allowance.id,
        customerId: 'concurrent',
        idempotencyKey: 'allowance-a',
      }),
      ledger.applyAllowance({
        policyId: allowance.id,
        customerId: 'concurrent',
        idempotencyKey: 'allowance-b',
      }),
    ]);
    expect(new Set(concurrent.map((result) => result.grant?.id)).size).toBe(1);
    expect(await ledger.listGrantPolicyApplications({ policyId: allowance.id })).toHaveLength(1);
    expect((await ledger.getBalance('concurrent')).postedAmount).toBe('2');

    const promotion = await ledger.createGrantPolicy({
      type: 'promotion',
      key: 'launch',
      amount: '3',
      expiresInMs: 10_000,
      idempotencyKey: 'promotion-policy',
    });
    const first = await ledger.claimPromotion({
      policyId: promotion.id,
      customerId: 'promo-customer',
      idempotencyKey: 'claim-a',
    });
    const second = await ledger.claimPromotion({
      policyId: promotion.id,
      customerId: 'promo-customer',
      idempotencyKey: 'claim-b',
    });
    expect(second.application.id).toBe(first.application.id);
    const promotionAccount = await ledger.getBalance('promo-customer');
    expect(await ledger.store.listGrants(promotionAccount.id)).toHaveLength(1);
    const eventTypes = (await ledger.listOutboxEvents()).map((event) => event.type);
    expect(eventTypes.filter((type) => type === 'credit.granted')).toHaveLength(2);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        'credit.policy.created',
        'credit.allowance.applied',
        'credit.promotion.claimed',
      ]),
    );
  });

  it('consumes promotions by nearest expiry, then allowance, then general credits', async () => {
    const { ledger, price } = await createFixture(1_000);
    await ledger.grantCredits({ customerId: 'priority', amount: '1', idempotencyKey: 'general' });
    const allowance = await ledger.createGrantPolicy({
      type: 'allowance',
      key: 'priority-allowance',
      cadence: 'month',
      amount: '1',
      idempotencyKey: 'priority-allowance-policy',
    });
    await ledger.applyAllowance({
      policyId: allowance.id,
      customerId: 'priority',
      idempotencyKey: 'priority-allowance',
    });
    const late = await ledger.createGrantPolicy({
      type: 'promotion',
      key: 'late-promo',
      amount: '1',
      expiresInMs: 20_000,
      idempotencyKey: 'late-policy',
    });
    const early = await ledger.createGrantPolicy({
      type: 'promotion',
      key: 'early-promo',
      amount: '1',
      expiresInMs: 10_000,
      idempotencyKey: 'early-policy',
    });
    await ledger.claimPromotion({
      policyId: late.id,
      customerId: 'priority',
      idempotencyKey: 'late-claim',
    });
    await ledger.claimPromotion({
      policyId: early.id,
      customerId: 'priority',
      idempotencyKey: 'early-claim',
    });
    const reservation = await ledger.reserveCredits({
      customerId: 'priority',
      priceId: price.id,
      estimatedUsage: { output_tokens: '187500' },
      idempotencyKey: 'priority-reserve',
    });
    const allocations = await (ledger.store as InMemoryCreditStore).listCreditLotAllocations(
      reservation.id,
    );
    const allocatedLots = await Promise.all(
      allocations.map(async (allocation) => ({
        lot: await ledger.getCreditLot(allocation.lotId),
        reservedUnits: allocation.reservedUnits,
      })),
    );
    const earlyAllocation = allocatedLots.find((item) => item.lot?.policyId === early.id);
    const lateAllocation = allocatedLots.find((item) => item.lot?.policyId === late.id);
    expect(earlyAllocation?.reservedUnits).toBe('1000000');
    expect(lateAllocation?.reservedUnits).toBe('500000');

    const committed = await ledger.commitUsage({
      reservationId: reservation.id,
      usageEventId: 'priority-usage',
      actualUsage: { output_tokens: '125000' },
      idempotencyKey: 'priority-commit',
    });
    const committedByPolicy = new Map(
      await Promise.all(
        (committed.receipt.allocations ?? []).map(
          async (allocation) =>
            [
              (await ledger.getCreditLot(allocation.lotId))?.policyId,
              allocation.consumedUnits,
            ] as const,
        ),
      ),
    );
    expect(committedByPolicy.get(early.id)).toBe('1000000');
    expect(committedByPolicy.get(late.id)).toBe('0');
  });

  it('burns expired promotion units released from a still-open reservation and allows commit', async () => {
    const { ledger, price, setNow } = await createFixture(1_000);
    const promotion = await ledger.createGrantPolicy({
      type: 'promotion',
      key: 'expiring',
      amount: '0.02',
      expiresInMs: 100,
      idempotencyKey: 'expiring-policy',
    });
    await ledger.claimPromotion({
      policyId: promotion.id,
      customerId: 'expiry-customer',
      idempotencyKey: 'expiring-claim',
    });
    const reservation = await ledger.reserveCredits({
      customerId: 'expiry-customer',
      priceId: price.id,
      estimatedUsage: { input_tokens: '2000', output_tokens: '1000' },
      expiresAt: 10_000,
      idempotencyKey: 'expiry-reserve',
    });
    setNow(1_101);
    const committed = await ledger.commitUsage({
      reservationId: reservation.id,
      usageEventId: 'expiry-usage',
      actualUsage: { input_tokens: '1000', output_tokens: '500' },
      idempotencyKey: 'expiry-commit',
    });
    expect(committed.receipt.amount).toBe('0.006');
    expect(committed.balance).toMatchObject({
      postedAmount: '0',
      reservedAmount: '0',
      availableAmount: '0',
    });
    expect((await ledger.listOutboxEvents()).map((event) => event.type)).toContain(
      'credit.lot.expired',
    );
  });

  it('expires promotion before reserve and burns a reserved promotion on release', async () => {
    const { ledger, price, setNow } = await createFixture(1_000);
    const policy = await ledger.createGrantPolicy({
      type: 'promotion',
      key: 'reserve-expiry',
      amount: '0.02',
      expiresInMs: 100,
      idempotencyKey: 'reserve-expiry-policy',
    });
    await ledger.claimPromotion({
      policyId: policy.id,
      customerId: 'expires-before-reserve',
      idempotencyKey: 'expires-before-reserve-claim',
    });
    setNow(1_101);
    await expect(
      ledger.reserveCredits({
        customerId: 'expires-before-reserve',
        priceId: price.id,
        estimatedUsage: { input_tokens: '1000' },
        idempotencyKey: 'expired-reserve',
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);

    setNow(2_000);
    await ledger.claimPromotion({
      policyId: policy.id,
      customerId: 'expires-after-reserve',
      idempotencyKey: 'expires-after-reserve-claim',
    });
    const reservation = await ledger.reserveCredits({
      customerId: 'expires-after-reserve',
      priceId: price.id,
      estimatedUsage: { input_tokens: '2000', output_tokens: '1000' },
      expiresAt: 10_000,
      idempotencyKey: 'open-promo-reserve',
    });
    setNow(2_101);
    const released = await ledger.releaseReservation({
      reservationId: reservation.id,
      idempotencyKey: 'release-expired-promo',
    });
    expect(released.balance.postedAmount).toBe('0');
    expect((await ledger.listCreditLots('expires-after-reserve'))[0]).toMatchObject({
      availableAmount: '0',
      reservedAmount: '0',
      expiredAmount: '0.02',
    });
  });

  it('uses lot priority for negative adjustments and supports partial consumption', async () => {
    const { ledger } = await createFixture(1_000);
    await ledger.grantCredits({
      customerId: 'adjust-priority',
      amount: '2',
      idempotencyKey: 'base',
    });
    const allowance = await ledger.createGrantPolicy({
      type: 'allowance',
      key: 'adjust-allowance',
      cadence: 'month',
      amount: '2',
      idempotencyKey: 'adjust-allowance-policy',
    });
    await ledger.applyAllowance({
      policyId: allowance.id,
      customerId: 'adjust-priority',
      idempotencyKey: 'adjust-allowance-apply',
    });
    const promotion = await ledger.createGrantPolicy({
      type: 'promotion',
      key: 'adjust-promo',
      amount: '2',
      expiresInMs: 10_000,
      idempotencyKey: 'adjust-promo-policy',
    });
    await ledger.claimPromotion({
      policyId: promotion.id,
      customerId: 'adjust-priority',
      idempotencyKey: 'adjust-promo-claim',
    });
    await ledger.adjustCredits({
      customerId: 'adjust-priority',
      amount: '-2.5',
      reason: 'administrative debit',
      idempotencyKey: 'priority-debit',
    });
    const lots = await ledger.listCreditLots('adjust-priority');
    expect(lots.find((lot) => lot.kind === 'promotion')?.consumedAmount).toBe('2');
    expect(lots.find((lot) => lot.kind === 'allowance')?.consumedAmount).toBe('0.5');
    expect(lots.find((lot) => lot.kind === 'general')?.consumedAmount).toBe('0');
  });

  it('fails policy commands closed for a legacy custom CreditStore', async () => {
    const base = new InMemoryCreditStore();
    const policyMethods = new Set([
      'getGrantPolicy',
      'listGrantPolicies',
      'getCreditLot',
      'listCreditLots',
      'listCreditLotAllocations',
      'getGrantPolicyApplication',
      'getGrantPolicyApplicationByIdentity',
      'listGrantPolicyApplications',
    ]);
    const legacy = new Proxy(base, {
      get(target, property, receiver) {
        if (typeof property === 'string' && policyMethods.has(property)) return undefined;
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as CreditStore;
    const ledger = new CreditLedger({ projectId: 'legacy', store: legacy });
    await expect(
      ledger.createGrantPolicy({
        type: 'allowance',
        key: 'unsupported',
        cadence: 'day',
        amount: '1',
        idempotencyKey: 'unsupported',
      }),
    ).rejects.toBeInstanceOf(UnsupportedCreditStoreCapabilityError);
    await expect(
      ledger.grantCredits({ customerId: 'legacy-customer', amount: '1', idempotencyKey: 'grant' }),
    ).resolves.toMatchObject({ account: { postedAmount: '1' } });
  });

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

  it('never credits the same network transaction through two funding rails', async () => {
    const { ledger } = await createFixture();
    const txHash = `0x${'ab'.repeat(32)}` as `0x${string}`;
    const direct = await ledger.createFundingIntent({
      customerId: 'cus_direct',
      amount: '1',
      rail: 'arc_direct',
      network: 'arc-testnet',
      invoiceId: 'direct-invoice',
      idempotencyKey: 'direct-intent',
    });
    const gateway = await ledger.createFundingIntent({
      customerId: 'cus_gateway',
      amount: '1',
      rail: 'circle_gateway_nanopayment',
      network: 'arc-testnet',
      invoiceId: 'gateway-invoice',
      idempotencyKey: 'gateway-intent',
    });

    await ledger.confirmFunding({
      fundingIntentId: direct.id,
      rail: 'arc_direct',
      network: 'arc-testnet',
      externalPaymentId: txHash,
      txHash,
      amount: '1',
      paymentReceiptId: 'direct-receipt',
      idempotencyKey: 'direct-confirm',
    });

    await expect(
      ledger.confirmFunding({
        fundingIntentId: gateway.id,
        rail: 'circle_gateway_nanopayment',
        network: 'arc-testnet',
        externalPaymentId: `gateway:${txHash}`,
        txHash,
        amount: '1',
        paymentReceiptId: 'gateway-receipt',
        requireExactAmount: true,
        idempotencyKey: 'gateway-confirm',
      }),
    ).rejects.toThrow('already assigned');

    expect((await ledger.getBalance('cus_direct')).postedAmount).toBe('1');
    expect((await ledger.getBalance('cus_gateway')).postedAmount).toBe('0');
    expect(await ledger.listFundingTransactions()).toHaveLength(1);
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

  it('keeps every public read scoped to the ledger project', async () => {
    const store = new InMemoryCreditStore();
    const first = new CreditLedger({ projectId: 'project_first', store });
    const second = new CreditLedger({ projectId: 'project_second', store });
    const meter = await second.registerMeter({
      key: 'tokens',
      dimensions: ['tokens'],
      idempotencyKey: 'meter-second',
    });
    const price = await second.createPriceVersion({
      meterKey: meter.key,
      rates: [{ dimension: 'tokens', unitSize: '1', amount: '0.01' }],
      idempotencyKey: 'price-second',
    });
    await second.grantCredits({
      customerId: 'shared_customer',
      amount: '2',
      idempotencyKey: 'grant-second',
    });
    const reservation = await second.reserveCredits({
      customerId: 'shared_customer',
      priceId: price.id,
      estimatedUsage: { tokens: '10' },
      idempotencyKey: 'reserve-second',
    });
    const committed = await second.commitUsage({
      reservationId: reservation.id,
      usageEventId: 'usage-second',
      actualUsage: { tokens: '5' },
      idempotencyKey: 'commit-second',
    });
    const intent = await second.createFundingIntent({
      customerId: 'shared_customer',
      amount: '1',
      rail: 'arc_direct',
      network: 'arc-testnet',
      invoiceId: 'invoice-second',
      idempotencyKey: 'intent-second',
    });
    const confirmed = await second.confirmFunding({
      fundingIntentId: intent.id,
      rail: 'arc_direct',
      network: 'arc-testnet',
      externalPaymentId: `0x${'ab'.repeat(32)}`,
      txHash: `0x${'ab'.repeat(32)}`,
      amount: '1',
      paymentReceiptId: 'receipt-second',
      idempotencyKey: 'confirm-second',
    });

    await expect(first.getReservation(reservation.id)).resolves.toBeUndefined();
    await expect(first.getUsageReceipt(committed.receipt.id)).resolves.toBeUndefined();
    await expect(first.getFundingIntent(intent.id)).resolves.toBeUndefined();
    await expect(
      first.getFundingTransaction(confirmed.fundingTransaction.id),
    ).resolves.toBeUndefined();
    await expect(first.listUsageReceipts()).resolves.toEqual([]);
    await expect(first.listLedgerEntries()).resolves.toEqual([]);
    await expect(first.listFundingTransactions()).resolves.toEqual([]);
    await expect(first.listFundingTransactions(intent.id)).resolves.toEqual([]);

    await expect(second.getReservation(reservation.id)).resolves.toMatchObject({
      projectId: 'project_second',
    });
    await expect(second.getUsageReceipt(committed.receipt.id)).resolves.toMatchObject({
      projectId: 'project_second',
    });
    await expect(second.listFundingTransactions(intent.id)).resolves.toHaveLength(1);
  });

  it('does not let another project replace a caller-selected funding intent id', async () => {
    const store = new InMemoryCreditStore();
    const victim = new CreditLedger({ projectId: 'project_victim', store });
    const attacker = new CreditLedger({ projectId: 'project_attacker', store });
    const original = await victim.createFundingIntent({
      id: 'fund_shared_id',
      customerId: 'victim_customer',
      amount: '5',
      network: 'arc-testnet',
      invoiceId: 'victim_invoice',
      idempotencyKey: 'victim_intent',
    });

    await expect(
      attacker.createFundingIntent({
        id: original.id,
        customerId: 'attacker_customer',
        amount: '1',
        network: 'arc-testnet',
        invoiceId: 'attacker_invoice',
        idempotencyKey: 'attacker_intent',
      }),
    ).rejects.toThrow('Funding intent id already exists');

    await expect(victim.getFundingIntent(original.id)).resolves.toMatchObject({
      projectId: 'project_victim',
      customerId: 'victim_customer',
      requestedAmount: '5',
    });
    await expect(attacker.getFundingIntent(original.id)).resolves.toBeUndefined();
  });
});
