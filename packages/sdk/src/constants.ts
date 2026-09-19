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

/** Arc Mainnet uses the same predeploy addresses as Arc Testnet. */
export const ARC_MAINNET_CONTRACTS = ARC_TESTNET_CONTRACTS;

/** Arc Mainnet configuration */
export const ARC_MAINNET: NetworkConfig = {
  id: 'arc',
  chainId: 5042,
  rpcUrl: 'https://rpc.mainnet.arc.io',
  name: 'Arc',
  usdcAddress: ARC_MAINNET_CONTRACTS.usdc,
  explorerUrl: 'https://explorer.arc.io',
  cctpDomainId: 26,
} as const;

/** Arc Testnet configuration */
export const ARC_TESTNET: NetworkConfig = {
  id: 'arc-testnet',
  chainId: 5042002,
  rpcUrl: 'https://rpc.testnet.arc.io',
  name: 'Arc Testnet',
  usdcAddress: ARC_TESTNET_CONTRACTS.usdc,
  explorerUrl: 'https://explorer.testnet.arc.io',
  cctpDomainId: 26,
} as const;

export function arcNetwork(environment: 'mainnet' | 'testnet'): NetworkConfig {
  return environment === 'mainnet' ? ARC_MAINNET : ARC_TESTNET;
}

/** Reject mixed Arc identity tuples while still allowing caller-selected RPC endpoints. */
export function assertArcNetworkConfig(network: NetworkConfig): void {
  const expected =
    network.chainId === ARC_MAINNET.chainId
      ? ARC_MAINNET
      : network.chainId === ARC_TESTNET.chainId
        ? ARC_TESTNET
        : undefined;
  if (!expected) {
    throw new Error('Arc network must use Mainnet chain 5042 or Testnet chain 5042002');
  }
  if (
    network.id !== expected.id ||
    network.usdcAddress.toLowerCase() !== expected.usdcAddress.toLowerCase() ||
    network.cctpDomainId !== expected.cctpDomainId
  ) {
    throw new Error(`Arc network configuration does not match ${expected.name}`);
  }
}

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
