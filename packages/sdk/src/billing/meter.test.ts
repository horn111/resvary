import { describe, it, expect, beforeEach } from 'vitest';
import { UsageMeter } from './meter.js';

describe('UsageMeter', () => {
  let meter: UsageMeter;
  const buyer1 = '0x1111111111111111111111111111111111111111' as const;
  const buyer2 = '0x2222222222222222222222222222222222222222' as const;

  beforeEach(() => {
    meter = new UsageMeter({ endpoint: '/api/data', maxRecords: 10 });
  });

  it('adds a usage record', () => {
    const record = meter.record({ buyer: buyer1, amount: '0.01' });
    expect(record.buyer).toBe(buyer1);
    expect(record.amount).toBe('0.01');
    expect(record.status).toBe('pending');
    expect(record.timestamp).toBeGreaterThan(0);
    expect(meter.getRecords().length).toBe(1);
  });

  it('calculates getSummary totals correctly', () => {
    meter.record({ buyer: buyer1, amount: '0.01' });
    meter.record({ buyer: buyer1, amount: '0.02' });

    const summary = meter.getSummary(buyer1);
    expect(summary.totalRequests).toBe(2);
    expect(summary.totalSpent).toBe('0.030000');
    expect(summary.avgCostPerRequest).toBe('0.015000');
  });

  it('getSummary returns zeros for unknown buyer', () => {
    const summary = meter.getSummary(buyer2);
    expect(summary.totalRequests).toBe(0);
    expect(summary.totalSpent).toBe('0');
  });

  it('filters records by buyer and status in getRecords', () => {
    const r1 = meter.record({ buyer: buyer1, amount: '0.01' });
    const r2 = meter.record({ buyer: buyer2, amount: '0.02' });

    // Manual mutate status for testing
    r1.status = 'settled';

    const settledRecords = meter.getRecords({ status: 'settled' });
    expect(settledRecords).toHaveLength(1);
    expect(settledRecords[0].buyer).toBe(buyer1);

    const buyer2Records = meter.getRecords({ buyer: buyer2 });
    expect(buyer2Records).toHaveLength(1);
    expect(buyer2Records[0].buyer).toBe(buyer2);
  });

  it('evicts oldest records when maxRecords limit reached', () => {
    for (let i = 0; i < 15; i++) {
      meter.record({ buyer: buyer1, amount: '0.01' });
    }
    expect(meter.getRecords()).toHaveLength(10);
  });

  it('getAggregateStats counts unique buyers and total revenue', () => {
    meter.record({ buyer: buyer1, amount: '0.01' });
    meter.record({ buyer: buyer1, amount: '0.02' });
    meter.record({ buyer: buyer2, amount: '0.03' });

    const stats = meter.getAggregateStats();
    expect(stats.totalRequests).toBe(3);
    expect(stats.uniqueBuyers).toBe(2);
    expect(stats.totalRevenue).toBe('0.060000');
    expect(stats.avgRevenuePerRequest).toBe('0.020000');
  });
});
