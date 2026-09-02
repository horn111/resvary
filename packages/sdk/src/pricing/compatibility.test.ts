import { describe, expect, it } from 'vitest';
import type {
  CreatePriceVersionInput,
  PriceRate,
  PriceRateInput,
  PriceVersion,
  RatedLineItem,
} from '../credits/index.js';

describe('pricing type compatibility', () => {
  it('keeps the 0.7 linear input and output shapes assignable', () => {
    const rateInput: PriceRateInput = {
      dimension: 'tokens',
      unitSize: '1000',
      amount: '0.001',
    };
    const createInput: CreatePriceVersionInput = {
      meterKey: 'tokens',
      rates: [rateInput],
      idempotencyKey: 'price-v1',
    };
    const rate: PriceRate = { ...rateInput, amountUnits: '1000' };
    const priceRates: PriceVersion['rates'] = [rate];
    const lineItem: RatedLineItem = {
      dimension: 'tokens',
      quantity: '1',
      unitSize: '1000',
      rateAmount: '0.001',
      rateUnits: '1000',
      amount: '0.000001',
      amountUnits: '1',
    };

    expect(createInput.rates).toEqual([rateInput]);
    expect(priceRates).toEqual([rate]);
    expect(lineItem).not.toHaveProperty('pricingModel');
  });
});
