# Usage Rating

Resvary prices integer usage dimensions without JavaScript floating point.

```typescript
const meter = await credits.registerMeter({
  key: 'llm_tokens',
  dimensions: ['input_tokens', 'output_tokens'],
  idempotencyKey: 'meter-v1',
});

const price = await credits.createPriceVersion({
  meterKey: meter.key,
  rates: [
    { dimension: 'input_tokens', unitSize: '1000', amount: '0.002' },
    { dimension: 'output_tokens', unitSize: '1000', amount: '0.008' },
  ],
  idempotencyKey: 'price-v1',
});
```

Each line item uses:

```text
ceil(quantity × rateAmountUnits / unitSize)
```

The receipt total is the sum of the individually rounded line items. Quantities and unit sizes are non-negative integer strings. Credit amounts support at most six decimal places.

Meters and price versions are immutable after creation. Changing rates creates a new version; existing receipts continue to reference the version used for their charge.

Version 0.5 supports linear multi-dimensional rates. Tiering, packages, monthly minimums, subscriptions, and allowances are intentionally deferred.
