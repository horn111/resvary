# Prepaid Credits

Resvary models closed-loop USD product credits for an individual merchant project. One account is identified by `projectId + customerId`; wallets and email addresses are not customer identities.

## Core flow

```typescript
const reservation = await credits.reserveCredits({
  customerId: 'customer_123',
  priceId: price.id,
  estimatedUsage: { input_tokens: '2000', output_tokens: '1000' },
  idempotencyKey: 'request_abc',
});

const completion = await callModel();

const result = await credits.commitUsage({
  reservationId: reservation.id,
  usageEventId: completion.id,
  actualUsage: {
    input_tokens: String(completion.usage.inputTokens),
    output_tokens: String(completion.usage.outputTokens),
  },
  idempotencyKey: 'request_abc:commit',
});
```

Use `runMetered` when provider execution and billing happen in the same process. The method stores an execution claim before the callback, so the same operation key cannot start another provider call through the bundled stores. A matching call on the active `CreditLedger` instance waits for the first call. Another instance receives `MeteredExecutionAlreadyClaimedError` and must reconcile the first execution.

Use the individual commands when a queue or worker separates reservation from execution. Persist the provider result before `commitUsage`, or inside the callback before returning from `runMetered`. After a commit error, retry `commitUsage` with the saved usage event and the same commit key only while the reservation remains open and unexpired; a committed event replays its receipt. If the reservation expired or was released, reconcile the saved result and charge explicitly instead of calling the provider again. Pass the operation key to providers that support idempotent requests because the SDK cannot make an external API call and a database transaction atomic.

`runMetered` checks status and expiry atomically when claiming execution. It persists overdue expiry without starting a callback. It does not extend the TTL: choose a TTL that covers the provider's expected execution time and the time needed to save and commit usage.

## Pricing

Price versions are immutable and can mix linear rates, graduated tiers, and package-priced
dimensions. Graduated tiers charge only the quantity inside each cumulative range. Packages charge
every started block and do not create reusable entitlements. Reserve and commit use the same
deterministic integer rating rules; see [Usage rating](usage-rating.md).

## Idempotency

Every mutating command requires an idempotency key. A repeated key with the same normalized payload returns the original result. The same key with different input throws `IdempotencyConflictError`.

Good keys already exist in most applications: request IDs, job IDs, provider response IDs, checkout IDs, and webhook event IDs. Do not generate a new key during a retry.

## Reservation limits

- Actual charges cannot exceed a reservation.
- Create another reservation before continuing a job that needs a higher limit.
- Open reservations expire after 15 minutes by default.
- Expiry is processed during reservations or with `releaseExpiredReservations`. Set `limit` for bounded maintenance batches.
- Manual, funding, allowance, and migrated legacy credits do not expire. Promotion policies require a positive expiry.

## Allowances and promotions

Allowance applications top the policy's unspent available plus reserved balance up to its target once per UTC period. They do not erase leftovers or accumulate above the target. Promotion claims are one-time per customer and policy version; the application owns eligibility and coupon checks.

Policy-capable stores allocate lots in this order: promotion by nearest expiry, allowance FIFO, then general and legacy FIFO. Open reservations retain promotion allocations after expiry. Commit remains allowed, while expired units released from the reservation burn. See [Grant policies and credit lots](grant-policies.md).

## Corrections

Ledger entries are immutable. Use `adjustCredits` with an explicit reason to issue a positive or negative correction. A negative adjustment cannot make available credits negative.
