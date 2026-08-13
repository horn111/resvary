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
});
