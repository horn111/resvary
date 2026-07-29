/**
 * Buyer SDK for automated x402 payment flow.
 *
 * Handles the complete payment lifecycle:
 * 1. Send request to a paywalled endpoint
 * 2. Receive 402 + payment requirements
 * 3. Sign EIP-3009 transferWithAuthorization
 * 4. Retry request with X-PAYMENT header
 *
 * @example
 * ```typescript
 * import { BuyerClient } from '@settlary/sdk/client';
 *
 * const buyer = new BuyerClient({
 *   privateKey: '0x...',
 *   rpcUrl: 'https://rpc.testnet.arc.network',
 * });
 *
 * const response = await buyer.request('https://api.example.com/premium/data');
 * console.log(response.data);
 * ```
 */

import { type Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { PaymentRequirements, PaymentPayload } from '../types.js';
import { ARC_TESTNET, DEFAULTS, HTTP_402, USDC_DECIMALS, X402_HEADER, PAYMENT_REQUIRED_HEADER } from '../constants.js';

/** Configuration for the BuyerClient */
export interface BuyerClientConfig {
  /** Buyer's private key (hex string with 0x prefix) */
  privateKey: `0x${string}`;
  /** RPC URL for the target network (default: Arc Testnet) */
  rpcUrl?: string;
  /** Chain ID (default: Arc Testnet) */
  chainId?: number;
  /** Maximum number of payment retries */
  maxRetries?: number;
  /** Custom fetch implementation */
  fetch?: typeof globalThis.fetch;
}

/** Response from a paid request */
export interface PaidResponse<T = unknown> {
  /** Response data */
  data: T;
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Payment details (if payment was made) */
  payment?: {
    amount: string;
    to: `0x${string}`;
    network: string;
  };
}

/**
 * Client for consuming x402-paywalled APIs.
 *
 * Automatically handles the 402 payment flow: detects paywalled endpoints,
 * signs payment authorizations, and retries requests with valid payments.
 */
export class BuyerClient {
  private readonly account: Account;
  private readonly chainId: number;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(config: BuyerClientConfig) {
    this.account = privateKeyToAccount(config.privateKey);
    this.chainId = config.chainId ?? ARC_TESTNET.chainId;
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  /** Get the buyer's wallet address */
  get address(): `0x${string}` {
    return this.account.address;
  }

  /**
   * Make a request to a potentially paywalled endpoint.
   * Automatically handles 402 → sign → retry flow.
   *
   * @param url - The endpoint URL
   * @param init - Optional fetch init options
   * @returns Response with data and payment info
   */
  async request<T = unknown>(
    url: string,
    init?: RequestInit,
  ): Promise<PaidResponse<T>> {
    // Initial request
    const initialResponse = await this.fetchFn(url, init);

    // If not 402, return directly
    if (initialResponse.status !== HTTP_402) {
      const data = await initialResponse.json() as T;
      return {
        data,
        status: initialResponse.status,
        headers: Object.fromEntries(initialResponse.headers.entries()),
      };
    }

    // Parse payment requirements from 402 response
    const requirements = await this.parsePaymentRequirements(initialResponse);

    if (!requirements) {
      throw new Error('Received 402 but could not parse payment requirements');
    }

    // Sign the payment
    const paymentPayload = await this.signPayment(requirements);

    // Encode payment as base64
    const encodedPayment = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

    // Retry with payment header
    const paidResponse = await this.fetchFn(url, {
      ...init,
      headers: {
        ...init?.headers,
        [X402_HEADER]: encodedPayment,
      },
    });

    const data = await paidResponse.json() as T;

    return {
      data,
      status: paidResponse.status,
      headers: Object.fromEntries(paidResponse.headers.entries()),
      payment: {
        amount: requirements.maxAmountRequired,
        to: requirements.payTo,
        network: requirements.network,
      },
    };
  }

  /**
   * Parse payment requirements from a 402 response.
   */
  private async parsePaymentRequirements(
    response: globalThis.Response,
  ): Promise<PaymentRequirements | null> {
    try {
      // Try to get requirements from header
      const headerValue = response.headers.get(PAYMENT_REQUIRED_HEADER);
      if (headerValue) {
        const decoded = Buffer.from(headerValue, 'base64').toString('utf-8');
        return JSON.parse(decoded) as PaymentRequirements;
      }

      // Fallback: try to get from response body
      const body = await response.json() as { requirements?: PaymentRequirements };
      return body.requirements ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Sign a payment authorization using EIP-3009.
   */
  private async signPayment(
    requirements: PaymentRequirements,
  ): Promise<PaymentPayload> {
    const now = Math.floor(Date.now() / 1000);
    const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}` as `0x${string}`;

    const authorization = {
      from: this.account.address,
      to: requirements.payTo,
      value: String(
        BigInt(Math.ceil(parseFloat(requirements.maxAmountRequired) * 10 ** USDC_DECIMALS)),
      ),
      validAfter: String(now - 60), // Valid from 1 minute ago (clock skew buffer)
      validBefore: String(now + DEFAULTS.paymentValiditySeconds),
      nonce,
    };

    // Sign the authorization using EIP-712 typed data
    if (!this.account.signTypedData) {
      throw new Error('Account does not support signTypedData');
    }
    const signature = await this.account.signTypedData({
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: BigInt(this.chainId),
        verifyingContract: ARC_TESTNET.usdcAddress,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    });

    return {
      x402Version: DEFAULTS.x402Version as 2,
      scheme: requirements.scheme ?? 'exact',
      network: requirements.network,
      payload: {
        signature,
        authorization,
      },
    };
  }
}
