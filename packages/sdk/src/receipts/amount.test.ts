import { describe, expect, it } from 'vitest';
import { isAmountAtLeast, stablecoinUnitsToString, toStablecoinUnits } from './amount.js';

describe('stablecoin amount helpers', () => {
  it('converts human-readable stablecoin amounts to 6-decimal units', () => {
    expect(toStablecoinUnits('19')).toBe(19_000_000n);
    expect(toStablecoinUnits('19.25')).toBe(19_250_000n);
    expect(toStablecoinUnits('0.000001')).toBe(1n);
  });

  it('rejects invalid amounts and excessive precision', () => {
    expect(() => toStablecoinUnits('-1')).toThrow(/Invalid stablecoin amount/);
    expect(() => toStablecoinUnits('1.0000001')).toThrow(/exceeds 6 decimals/);
  });

  it('formats units back to a compact decimal string', () => {
    expect(stablecoinUnitsToString(19_250_000n)).toBe('19.25');
    expect(stablecoinUnitsToString(1n)).toBe('0.000001');
  });

  it('compares received and required amounts', () => {
    expect(isAmountAtLeast('19.00', '19')).toBe(true);
    expect(isAmountAtLeast('18.999999', '19')).toBe(false);
  });
});
