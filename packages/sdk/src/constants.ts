/**
 * Arc network configuration constants.
 */

import type { NetworkConfig } from './types.js';

/** USDC uses 6 decimal places */
export const USDC_DECIMALS = 6;

/** Minimum payment amount in USDC */
export const MIN_PAYMENT = '0.000001';

/** x402 protocol header name */
export const X402_HEADER = 'x-payment';

/** x402 payment requirements header */
export const PAYMENT_REQUIRED_HEADER = 'x-payment-requirements';

/** HTTP 402 status code */
export const HTTP_402 = 402;

/** Arc Testnet predeployed contract addresses */
export const ARC_TESTNET_CONTRACTS = {
  /** Optional ERC-20 interface for Arc's native USDC balance (6 decimals) */
  usdc: '0x3600000000000000000000000000000000000000',
  /** Predeployed transaction memo contract */
  memo: '0x5294E9927c3306DcBaDb03fe70b92e01cCede505',
  /** Native USDC system event emitter (18 decimals) */
  nativeUsdcSystemEmitter: '0xfffffffffffffffffffffffffffffffffffffffe',
} as const;

/** Arc Testnet configuration */
export const ARC_TESTNET: NetworkConfig = {
  chainId: 5042002,
  rpcUrl: 'https://rpc.testnet.arc.network',
  name: 'Arc Testnet',
  usdcAddress: ARC_TESTNET_CONTRACTS.usdc,
  explorerUrl: 'https://testnet.arcscan.app',
  cctpDomainId: 26,
} as const;

/** Default configuration values */
export const DEFAULTS = {
  network: 'arc-testnet',
  scheme: 'exact',
  x402Version: 2,
  /** Default payment validity window: 1 hour */
  paymentValiditySeconds: 3600,
  /** Default batch settlement interval: 5 minutes */
  batchIntervalMs: 300_000,
} as const;
