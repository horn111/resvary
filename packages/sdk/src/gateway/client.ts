/**
 * Arc wallet balance reader.
 *
 * This client reads the native USDC balance exposed by Arc RPC. It does not
 * query Circle Gateway unified balances or pending Gateway settlements.
 */

import { createPublicClient, formatUnits, http, parseUnits, type PublicClient } from 'viem';
import { ARC_TESTNET } from '../constants.js';
import type { NetworkConfig } from '../types.js';

/** Arc exposes native USDC with 18 RPC balance decimals. */
export const ARC_NATIVE_USDC_DECIMALS = 18;

export interface ArcWalletBalanceClientConfig {
  walletAddress: `0x${string}`;
  rpcUrl?: string;
  network?: NetworkConfig;
}

/** @deprecated Use ArcWalletBalanceClientConfig. */
export type GatewayClientConfig = ArcWalletBalanceClientConfig;

export interface BalanceInfo {
  /** Native Arc USDC balance, formatted with 18 RPC decimals. */
  available: string;
  /** Always zero: this client does not query Gateway pending settlements. */
  pending: '0';
  /** Equal to available for this Arc wallet reader. */
  total: string;
  lastUpdated: number;
}

export interface SettlementRecord {
  txHash: `0x${string}`;
  amount: string;
  batchSize: number;
  timestamp: number;
  blockNumber: bigint;
}

export class ArcWalletBalanceClient {
  private readonly walletAddress: `0x${string}`;
  private readonly client: PublicClient;
  private readonly network: NetworkConfig;

  constructor(config: ArcWalletBalanceClientConfig) {
    this.walletAddress = config.walletAddress;
    this.network = config.network ?? ARC_TESTNET;
    this.client = createPublicClient({
      transport: http(config.rpcUrl ?? this.network.rpcUrl),
    });
  }

  async getBalance(): Promise<BalanceInfo> {
    const balance = await this.client.getBalance({
      address: this.walletAddress,
    });
    const available = formatUnits(balance, ARC_NATIVE_USDC_DECIMALS);
    return {
      available,
      pending: '0',
      total: available,
      lastUpdated: Date.now(),
    };
  }

  getAddress(): `0x${string}` {
    return this.walletAddress;
  }

  getNetwork(): NetworkConfig {
    return this.network;
  }

  getExplorerUrl(txHash: `0x${string}`): string {
    return `${this.network.explorerUrl}/tx/${txHash}`;
  }

  getAddressExplorerUrl(): string {
    return `${this.network.explorerUrl}/address/${this.walletAddress}`;
  }

  async hasSufficientBalance(amount: string): Promise<boolean> {
    const rawBalance = await this.client.getBalance({
      address: this.walletAddress,
    });
    return rawBalance >= parseUnits(amount, ARC_NATIVE_USDC_DECIMALS);
  }
}

/**
 * @deprecated This name implied a Circle Gateway client. Use
 * ArcWalletBalanceClient for Arc RPC balances or @resvary/circle for Gateway.
 */
export class GatewayClient extends ArcWalletBalanceClient {}
