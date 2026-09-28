// Product rates cover both the buyer agent and document analysis in paid mode.
// The transport bounds each request; eight agent turns plus one analysis fit here.
export const FREE_RUNS_PER_IP = 3;
export const PAID_ESTIMATED_USAGE = {
  input_tokens: String(9 * 17_024),
  output_tokens: String(8 * 512 + 1_024),
} as const;
export const PAID_MAX_UNITS =
  BigInt(PAID_ESTIMATED_USAGE.input_tokens) * 2n + BigInt(PAID_ESTIMATED_USAGE.output_tokens) * 8n;
export const PAID_MAX_AMOUNT = (Number(PAID_MAX_UNITS) / 1_000_000).toFixed(6);
export const TOP_UP_AMOUNTS = ['0.50', '1.00', '5.00'] as const;
export const walletCustomer = (address: string) => `wallet_${address.toLowerCase()}`;
