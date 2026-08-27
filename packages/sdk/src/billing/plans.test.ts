import { describe, it, expect } from 'vitest';
import { createBillingPlan } from './plans.js';

describe('Billing Plans', () => {
  describe('per-request model', () => {
    const plan = createBillingPlan({
      name: 'API',
      pricing: { model: 'per-request', pricePerRequest: '0.005' },
    });

    it('calculates cost for 1 request by default', () => {
      expect(plan.calculateCost({})).toBe('0.005000');
    });

    it('calculates cost for N requests', () => {
      expect(plan.calculateCost({ requests: 10 })).toBe('0.050000');
    });

    it('getMinimumPayment returns correct minimum', () => {
      expect(plan.getMinimumPayment()).toBe('0.005');
    });
  });

  describe('per-second model', () => {
    const plan = createBillingPlan({
      name: 'Compute',
      pricing: { model: 'per-second', pricePerSecond: '0.02', minimumSeconds: 5 },
    });

    it('respects minimum billable seconds', () => {
      expect(plan.calculateCost({ seconds: 2 })).toBe('0.100000'); // 5 * 0.02
    });

    it('calculates exact duration when over minimum', () => {
      expect(plan.calculateCost({ seconds: 10 })).toBe('0.200000'); // 10 * 0.02
    });

    it('getMinimumPayment returns correct minimum', () => {
      expect(plan.getMinimumPayment()).toBe('0.100000'); // 0.02 * 5
    });
  });

  describe('per-job model', () => {
    const plan = createBillingPlan({
      name: 'Batch',
      pricing: { model: 'per-job', basePrice: '0.50', pricePerUnit: '0.001' },
    });

    it('calculates base price when no units provided', () => {
      expect(plan.calculateCost({})).toBe('0.500000');
    });

    it('calculates base price + per-unit cost', () => {
      expect(plan.calculateCost({ units: 100 })).toBe('0.600000'); // 0.50 + (100 * 0.001)
    });

    it('getMinimumPayment returns correct minimum', () => {
      expect(plan.getMinimumPayment()).toBe('0.50');
    });
  });
});
