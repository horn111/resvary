# Migrate from 0.7 to 0.8

Upgrade all six Resvary packages together. Version 0.8 adds opt-in graduated tiers and package
pricing. Existing linear price definitions, persisted price versions, receipts, events, funding
flows, and CLI flags remain valid.

## Database deployment

No database migration is required. SQLite remains on schema v5 and PostgreSQL remains on schema
v3. Advanced price definitions and receipt breakdowns use the existing JSON payload columns.

Continue to run the normal PostgreSQL migration check before application rollout:

```bash
npx resvary-postgres status
npx resvary-postgres migrate
```

The migrate command should report no pending schema version when upgrading from 0.7.

## Application rollout

Existing code can update package versions without changing its linear `rates` definitions. To use
advanced pricing, create a new immutable price version with `components`; do not edit a price that
has already been used by a reservation or receipt.

```typescript
const price = await credits.createPriceVersion({
  meterKey: meter.key,
  components: [
    {
      model: 'graduated',
      dimension: 'tokens',
      tiers: [
        { upTo: '1000000', unitSize: '1000', amount: '0.002' },
        { unitSize: '1000', amount: '0.001' },
      ],
    },
  ],
  idempotencyKey: 'tokens-price-v2',
});
```

Roll out readers before writers if your application renders receipt line items itself. Readers
must tolerate the optional graduated/package fields before the application starts creating
advanced prices.

## Compatibility limits

- Tiered pricing is graduated, not volume-based.
- Package pricing charges started blocks; it does not track reusable package entitlements.
- Monthly minimums, subscriptions, bundles with overage, coupons, refunds, and additional
  currencies remain outside the SDK.
