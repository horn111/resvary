# Prepaid Credits

Settlary models closed-loop USD product credits for an individual merchant project. One account is identified by `projectId + customerId`; wallets and email addresses are not customer identities.

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

Use `runMetered` when provider execution and billing happen in the same process. Use the individual commands when a queue or worker separates reservation from execution.

## Idempotency

Every mutating command requires an idempotency key. A repeated key with the same normalized payload returns the original result. The same key with different input throws `IdempotencyConflictError`.

Good keys already exist in most applications: request IDs, job IDs, provider response IDs, checkout IDs, and webhook event IDs. Do not generate a new key during a retry.

## Reservation limits

- Actual charges cannot exceed a reservation.
- Create another reservation before continuing a job that needs a higher limit.
- Open reservations expire after 15 minutes by default.
- Expiry is processed lazily during reservations or explicitly with `releaseExpiredReservations`.
- Credit grants do not expire in the alpha.

## Corrections

Ledger entries are immutable. Use `adjustCredits` with an explicit reason to issue a positive or negative correction. A negative adjustment cannot make available credits negative.
