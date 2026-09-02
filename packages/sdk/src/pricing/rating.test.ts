import { describe, expect, it } from 'vitest';
import { createMeterDefinition, createPriceVersion, rateUsage } from './rating.js';

describe('usage rating', () => {
  const meter = createMeterDefinition({
    id: 'meter_tokens',
    projectId: 'project_test',
    key: 'llm_tokens',
    dimensions: ['input_tokens', 'output_tokens'],
    createdAt: 1,
  });
  const price = createPriceVersion({
    id: 'price_v1',
    projectId: 'project_test',
    meter,
    version: 1,
    createdAt: 2,
    rates: [
      { dimension: 'input_tokens', unitSize: '1000', amount: '0.002' },
      { dimension: 'output_tokens', unitSize: '1000', amount: '0.008' },
    ],
  });

  it('rates each dimension with deterministic ceiling', () => {
    const result = rateUsage(price, { input_tokens: '1001', output_tokens: '1' });
    expect(result.totalUnits).toBe('2010');
    expect(result.totalAmount).toBe('0.00201');
    expect(result.lineItems.map((item) => item.amountUnits)).toEqual(['2002', '8']);
  });

  it('rejects unpriced and fractional quantities', () => {
    expect(() => rateUsage(price, { images: '1' })).toThrow('unpriced dimension');
    expect(() => rateUsage(price, { input_tokens: '1.5' })).toThrow('non-negative integer');
  });

  it('keeps legacy linear price versions and line items unchanged', () => {
    expect(price).toEqual({
      id: 'price_v1',
      projectId: 'project_test',
      meterId: 'meter_tokens',
      meterKey: 'llm_tokens',
      version: 1,
      currency: 'USD',
      rates: [
        {
          dimension: 'input_tokens',
          unitSize: '1000',
          amount: '0.002',
          amountUnits: '2000',
        },
        {
          dimension: 'output_tokens',
          unitSize: '1000',
          amount: '0.008',
          amountUnits: '8000',
        },
      ],
      createdAt: 2,
    });
    expect(rateUsage(price, { input_tokens: '1' }).lineItems[0]).toEqual({
      dimension: 'input_tokens',
      quantity: '1',
      unitSize: '1000',
      rateAmount: '0.002',
      rateUnits: '2000',
      amount: '0.000002',
      amountUnits: '2',
    });
  });

  const advancedMeter = createMeterDefinition({
    id: 'meter_advanced',
    projectId: 'project_test',
    key: 'multimodal',
    dimensions: ['input_tokens', 'output_tokens', 'images'],
    createdAt: 3,
  });
  const advancedPrice = createPriceVersion({
    id: 'price_advanced',
    projectId: 'project_test',
    meter: advancedMeter,
    version: 1,
    createdAt: 4,
    rates: [{ dimension: 'output_tokens', unitSize: '1000', amount: '0.002' }],
    components: [
      {
        model: 'graduated',
        dimension: 'input_tokens',
        tiers: [
          { upTo: '1000', unitSize: '1000', amount: '0.001' },
          { upTo: '2000', unitSize: '1000', amount: '0.0008' },
          { unitSize: '1000', amount: '0.0005' },
        ],
      },
      { model: 'package', dimension: 'images', packageSize: '10', amount: '1.5' },
    ],
  });

  it('keeps advanced-only rates as an empty compatibility array', () => {
    const advancedOnly = createPriceVersion({
      id: 'price_advanced_only',
      projectId: 'project_test',
      meter: advancedMeter,
      version: 2,
      components: [{ model: 'package', dimension: 'images', packageSize: '10', amount: '1.5' }],
    });
    expect(advancedOnly.rates).toEqual([]);
    expect(advancedOnly.components?.map((component) => component.model)).toEqual(['package']);
  });

  it('rates graduated tiers independently at exact boundaries', () => {
    const cases = [
      ['0', ['0', '0', '0']],
      ['1000', ['1000', '0', '0']],
      ['1001', ['1000', '1', '0']],
      ['2001', ['1000', '800', '1']],
    ] as const;
    for (const [quantity, expected] of cases) {
      const result = rateUsage(advancedPrice, { input_tokens: quantity });
      const tiers = result.lineItems.filter((item) => item.pricingModel === 'graduated');
      expect(tiers.map((item) => item.amountUnits)).toEqual(expected);
      expect(tiers.map((item) => item.tierIndex)).toEqual([0, 1, 2]);
    }
  });

  it('charges every started package and records zero usage', () => {
    const cases = [
      ['0', '0', '0'],
      ['1', '1', '1500000'],
      ['10', '1', '1500000'],
      ['11', '2', '3000000'],
    ] as const;
    for (const [quantity, count, amountUnits] of cases) {
      const result = rateUsage(advancedPrice, { images: quantity });
      const item = result.lineItems.find((candidate) => candidate.pricingModel === 'package');
      expect(item).toMatchObject({
        quantity,
        packageSize: '10',
        packageCount: count,
        amountUnits,
      });
    }
  });

  it('combines linear, graduated, and package dimensions with BigInt arithmetic', () => {
    const result = rateUsage(advancedPrice, {
      input_tokens: '2001',
      output_tokens: '1000',
      images: '11',
    });
    expect(result.totalUnits).toBe('3003801');
    expect(result.totalAmount).toBe('3.003801');
    expect(
      rateUsage(advancedPrice, {
        input_tokens: '9007199254740993000000000000000000000',
      }).totalUnits,
    ).toBe('4503599627370496500000000000000000800');
  });

  it('rejects invalid advanced component definitions', () => {
    const definition = {
      id: 'invalid',
      projectId: 'project_test',
      meter: advancedMeter,
      version: 1,
      components: [],
    };
    expect(() => createPriceVersion(definition)).toThrow('at least one component');
    expect(() =>
      createPriceVersion({
        ...definition,
        components: [
          {
            model: 'graduated' as const,
            dimension: 'input_tokens',
            tiers: [
              { unitSize: '1', amount: '1' },
              { unitSize: '1', amount: '1' },
            ],
          },
        ],
      }),
    ).toThrow('Only the final');
    expect(() =>
      createPriceVersion({
        ...definition,
        components: [
          {
            model: 'graduated' as const,
            dimension: 'input_tokens',
            tiers: [{ upTo: '10', unitSize: '1', amount: '1' }],
          },
        ],
      }),
    ).toThrow('final graduated tier');
    expect(() =>
      createPriceVersion({
        ...definition,
        components: [
          {
            model: 'graduated' as const,
            dimension: 'input_tokens',
            tiers: [
              { upTo: '10', unitSize: '1', amount: '1' },
              { upTo: '9', unitSize: '1', amount: '1' },
              { unitSize: '1', amount: '1' },
            ],
          },
        ],
      }),
    ).toThrow('strictly increasing');
    expect(() =>
      createPriceVersion({
        ...definition,
        rates: [{ dimension: 'images', unitSize: '1', amount: '1' }],
        components: [{ model: 'package', dimension: 'images', packageSize: '10', amount: '1' }],
      }),
    ).toThrow('Duplicate price dimension');
    expect(() =>
      createPriceVersion({
        ...definition,
        components: [{ model: 'package', dimension: 'audio', packageSize: '10', amount: '1' }],
      }),
    ).toThrow('Unknown meter dimension');
  });
});
