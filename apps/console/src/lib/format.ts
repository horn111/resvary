export function formatUnits(units: string, sign = false): string {
  const value = BigInt(units);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0');
  const prefix = negative ? '-' : sign && value > 0n ? '+' : '';
  return `${prefix}$${whole.toLocaleString('en-US')}.${fraction || '00'}`;
}

export function formatTimestamp(value: number): string {
  return new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC');
}
