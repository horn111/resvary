# Usage Rating

Resvary prices integer usage dimensions without JavaScript floating point. One immutable price
version can combine legacy linear rates with graduated and package components, provided each
dimension appears once.

## Linear rates

```typescript
const price = await credits.createPriceVersion({
  meterKey: meter.key,
  rates: [{ dimension: 'output_tokens', unitSize: '1000', amount: '0.008' }],
  idempotencyKey: 'price-v1',
});
```

Each linear line item uses:

```text
ceil(quantity × rateAmountUnits / unitSize)
```

The existing `PriceRateInput`, `PriceRate`, and linear receipt shape remain unchanged.

## Graduated tiers and packages

```typescript
const meter = await credits.registerMeter({
  key: 'multimodal',
  dimensions: ['input_tokens', 'output_tokens', 'images'],
  idempotencyKey: 'multimodal-meter-v1',
});

const price = await credits.createPriceVersion({
  meterKey: meter.key,
  rates: [{ dimension: 'output_tokens', unitSize: '1000', amount: '0.008' }],
  components: [
    {
      model: 'graduated',
      dimension: 'input_tokens',
      tiers: [
        { upTo: '1000000', unitSize: '1000', amount: '0.002' },
        { upTo: '5000000', unitSize: '1000', amount: '0.0015' },
        { unitSize: '1000', amount: '0.001' },
      ],
    },
    {
      model: 'package',
      dimension: 'images',
      packageSize: '10',
      amount: '0.5',
    },
  ],
  idempotencyKey: 'multimodal-price-v1',
});
```

Graduated tiers use cumulative `upTo` boundaries. Boundaries must be positive, strictly
increasing integer strings, and the final tier must omit `upTo`. Each tier charges only the
quantity inside its range and rounds up independently:

```text
ceil(tierQuantity × tierAmountUnits / tierUnitSize)
```

Package pricing charges every started block:

```text
packageCount = ceil(quantity / packageSize)
charge = packageCount × packageAmountUnits
```

Zero quantity produces zero packages and a zero charge. Package pricing does not grant reusable
units and is not a subscription or bundle-with-overage model.

`RatedLineItem` and `UsageReceipt.lineItems` expose the calculation. Graduated items include the
tier index and range; package items include `packageSize` and `packageCount`. Legacy linear items
do not gain these optional fields.

Receipt totals sum the individually rounded line items. Quantities, boundaries, and unit sizes are
integer strings. Credit amounts support at most six decimal places. Unknown usage dimensions fail
closed instead of being ignored.

Meters and price versions are immutable. Changing a rate, tier boundary, or package creates a new
version. Existing price versions and receipts remain valid.
