/**
 * Circle Gateway client for unified balance management.
 *
 * @example
 * ```typescript
 * import { GatewayClient } from '@resvary/sdk/gateway';
 *
 * const gateway = new GatewayClient({
 *   walletAddress: '0x...',
 *   rpcUrl: 'https://rpc.testnet.arc.network',
 * });
 *
 * const balance = await gateway.getBalance();
 * console.log(`Balance: ${balance.available} USDC`);
 * ```
 */

import { createPublicClient, http, formatUnits, type PublicClient } from 'viem';
import { ARC_TESTNET, USDC_DECIMALS } from '../constants.js';
import type { NetworkConfig } from '../types.js';

/** Configuration for the Gateway client */
export interface GatewayClientConfig {
  /** Wallet address to monitor */
  walletAddress: `0x${string}`;
  /** RPC URL (default: Arc Testnet) */
  rpcUrl?: string;
  /** Network configuration */
  network?: NetworkConfig;
}

/** Balance information */
export interface BalanceInfo {
  /** Available balance in USDC (human-readable) */
  available: string;
  /** Pending settlements in USDC */
  pending: string;
  /** Total (available + pending) */
  total: string;
  /** Last updated timestamp */
  lastUpdated: number;
}

/** Settlement record */
export interface SettlementRecord {
  /** Transaction hash */
  txHash: `0x${string}`;
  /** Amount settled in USDC */
  amount: string;
  /** Number of payments in the batch */
  batchSize: number;
  /** Settlement timestamp */
  timestamp: number;
  /** Block number */
  blockNumber: bigint;
}

/**
 * Client for interacting with Circle Gateway unified balance.
 *
 * Provides methods for checking balances, monitoring deposits,
 * and tracking batch settlements on Arc.
 */
export class GatewayClient {
  private readonly walletAddress: `0x${string}`;
  private readonly client: PublicClient;
  private readonly network: NetworkConfig;

  constructor(config: GatewayClientConfig) {
    this.walletAddress = config.walletAddress;
    this.network = config.network ?? ARC_TESTNET;

    this.client = createPublicClient({
      transport: http(config.rpcUrl ?? this.network.rpcUrl),
    });
  }

  /**
   * Get the current USDC balance for the wallet.
   */
  async getBalance(): Promise<BalanceInfo> {
    const balance = await this.client.getBalance({
      address: this.walletAddress,
    });

    // On Arc, native balance is USDC
    const available = formatUnits(balance, USDC_DECIMALS);

    return {
      available,
      pending: '0.000000', // TODO: Query Gateway API for pending settlements
      total: available,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get the wallet address.
   */
  getAddress(): `0x${string}` {
    return this.walletAddress;
  }

  /**
   * Get the network configuration.
   */
  getNetwork(): NetworkConfig {
    return this.network;
  }

  /**
   * Get the block explorer URL for a transaction.
   */
  getExplorerUrl(txHash: `0x${string}`): string {
    return `${this.network.explorerUrl}/tx/${txHash}`;
  }

  /**
   * Get the block explorer URL for the wallet address.
   */
  getAddressExplorerUrl(): string {
    return `${this.network.explorerUrl}/address/${this.walletAddress}`;
  }

  /**
   * Check if the wallet has sufficient balance for a given amount.
   */
  async hasSufficientBalance(amount: string): Promise<boolean> {
    const balance = await this.getBalance();
    return parseFloat(balance.available) >= parseFloat(amount);
  }
}
