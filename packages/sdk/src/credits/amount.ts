export const CREDIT_DECIMALS = 6;
export const CREDIT_SCALE = 10n ** BigInt(CREDIT_DECIMALS);

const CREDIT_AMOUNT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/;

export function toCreditUnits(amount: string): bigint {
  const normalized = amount.trim();
  const match = CREDIT_AMOUNT_PATTERN.exec(normalized);
  if (!match) {
    throw new Error(`Invalid USD credit amount: ${amount}`);
  }

  const whole = BigInt(match[1]!);
  const fraction = (match[2] ?? '').padEnd(CREDIT_DECIMALS, '0');
  return whole * CREDIT_SCALE + BigInt(fraction || '0');
}

export function creditUnitsToString(units: bigint): string {
  const sign = units < 0n ? '-' : '';
  const absolute = units < 0n ? -units : units;
  const whole = absolute / CREDIT_SCALE;
  const fraction = (absolute % CREDIT_SCALE)
    .toString()
    .padStart(CREDIT_DECIMALS, '0')
    .replace(/0+$/, '');

  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function parseCreditUnits(units: string, label = 'units'): bigint {
  if (!/^-?\d+$/.test(units)) {
    throw new Error(`Invalid ${label}: ${units}`);
  }

  return BigInt(units);
}

export function divideCeil(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new Error('divideCeil requires a non-negative numerator and positive denominator');
  }

  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}
