# Grant Policies and Credit Lots

Resvary 0.7 adds explicit application commands for recurring allowances and one-time promotions. A policy is immutable after creation. Create another policy version when its amount, cadence, expiry, or metadata changes.

## Monthly allowance

```typescript
const policy = await credits.createGrantPolicy({
  type: 'allowance',
  key: 'pro-monthly-credits',
  cadence: 'month',
  amount: '25',
  idempotencyKey: 'policy:pro-monthly-credits:v1',
});

const result = await credits.applyAllowance({
  policyId: policy.id,
  customerId: 'customer_123',
  idempotencyKey: 'allowance:customer_123:2026-08',
});
```

Allowance periods come only from the ledger's injected `now()` clock in UTC. A day starts at `00:00 UTC`, a week starts Monday, and a month starts on its first UTC day. One application may exist for each customer, policy version, and period.

At the start of a new period, Resvary compares the policy target with the unspent amount from that policy. Unspent means available plus reserved units. Resvary grants only the difference. The remaining balance neither expires nor accumulates beyond the target.

## Promotional grant

```typescript
const promotion = await credits.createGrantPolicy({
  type: 'promotion',
  key: 'launch-credit',
  amount: '5',
  expiresInMs: 14 * 24 * 60 * 60 * 1000,
  idempotencyKey: 'policy:launch-credit:v1',
});

await credits.claimPromotion({
  policyId: promotion.id,
  customerId: 'customer_123',
  idempotencyKey: 'promotion:launch-credit:customer_123',
});
```

The application must check eligibility, segments, and coupon validity before calling `claimPromotion`. Resvary guarantees one claim per customer and policy version, even when callers use different idempotency keys. Expiry is the claim time plus the policy's positive `expiresInMs`.

## Consumption and expiry

Reservations allocate credit lots in this order:

1. promotion lots with the nearest expiry;
2. allowance lots in FIFO order;
3. general and migrated legacy lots in FIFO order.

New usage receipts include optional `allocations`. Historical receipts remain valid without the field.

An open reservation keeps its promotional allocation after the lot expires. A commit may consume those reserved units. When the reservation commits below its maximum or is released, any expired promotional remainder burns instead of returning to available balance.

Normal balance operations reconcile expired available units transactionally. Run a bulk sweep for inactive accounts:

```typescript
await credits.sweepExpiredCreditLots({
  before: Date.now(),
  limit: 500,
});
```

Resvary does not run a scheduler. Invoke the sweep from application-owned maintenance infrastructure.

## Custom stores

`CreditStore` remains the compatibility contract for existing grants, reservations, usage, funding, and outbox operations. Policy and lot commands require the optional `CreditPolicyStore` capability. A legacy custom store receives `UnsupportedCreditStoreCapabilityError` for those commands while its previous flows continue to work.
