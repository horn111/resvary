/**
 * Stablecoin amount helpers.
 */

export const STABLECOIN_DECIMALS = 6;

export function toStablecoinUnits(amount: string, decimals = STABLECOIN_DECIMALS): bigint {
  const normalized = amount.trim();

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid stablecoin amount: ${amount}`);
  }

  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Stablecoin amount exceeds ${decimals} decimals: ${amount}`);
  }

  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
}

export function stablecoinUnitsToString(units: bigint, decimals = STABLECOIN_DECIMALS): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = units / divisor;
  const fraction = units % divisor;
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');

  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

export function isAmountAtLeast(received: string, required: string): boolean {
  return toStablecoinUnits(received) >= toStablecoinUnits(required);
}
