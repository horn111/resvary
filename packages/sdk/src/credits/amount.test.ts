import { describe, expect, it } from 'vitest';
import { creditUnitsToString, divideCeil, toCreditUnits } from './amount.js';

describe('credit amounts', () => {
  it('converts USD credits without floating point', () => {
    expect(toCreditUnits('19.000001')).toBe(19_000_001n);
    expect(creditUnitsToString(19_000_001n)).toBe('19.000001');
    expect(creditUnitsToString(-1_250_000n)).toBe('-1.25');
  });

  it('rejects invalid precision and notation', () => {
    expect(() => toCreditUnits('0.0000001')).toThrow('Invalid USD credit amount');
    expect(() => toCreditUnits('1e-3')).toThrow('Invalid USD credit amount');
    expect(() => toCreditUnits('-1')).toThrow('Invalid USD credit amount');
  });

  it('rounds integer division upward', () => {
    expect(divideCeil(1n, 1000n)).toBe(1n);
    expect(divideCeil(2000n, 1000n)).toBe(2n);
  });
});
