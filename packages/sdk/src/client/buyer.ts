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
 * import { BuyerClient } from '@resvary/sdk/client';
 *
 * const buyer = new BuyerClient({
 *   privateKey: '0x...',
 *   rpcUrl: 'https://rpc.testnet.arc.network',
 *   paymentPolicy: {
 *     maxAmount: '0.10',
 *     maxTotalAmount: '1.00',
 *     allowedPayTo: ['0x1111111111111111111111111111111111111111'],
 *   },
 * });
 *
 * const response = await buyer.request('https://api.example.com/premium/data');
 * console.log(response.data);
 * ```
 */

import { getAddress, type Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { PaymentRequirements, PaymentPayload } from '../types.js';
import { toStablecoinUnits } from '../receipts/amount.js';
import {
  ARC_TESTNET,
  DEFAULTS,
  HTTP_402,
  USDC_DECIMALS,
  X402_HEADER,
  PAYMENT_REQUIRED_HEADER,
} from '../constants.js';

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
  /** Required fail-closed policy for automatic payment signatures. */
  paymentPolicy?: BuyerPaymentPolicy;
}

export interface BuyerPaymentProposal {
  readonly url: string;
  readonly origin: string;
  readonly requirements: Readonly<PaymentRequirements>;
  readonly amountUnits: bigint;
}

export interface BuyerPaymentPolicy {
  /** Maximum amount signed for one request, in human-readable USDC. */
  maxAmount: string;
  /** Maximum amount signed by this client instance, in human-readable USDC. */
  maxTotalAmount: string;
  /** Exact recipient allowlist. */
  allowedPayTo: readonly `0x${string}`[];
  /** Allowed final response origins. Defaults to the requested URL origin. */
  allowedOrigins?: readonly string[];
  /** Optional application approval hook called with normalized terms before signing. */
  approve?: (proposal: BuyerPaymentProposal) => boolean | Promise<boolean>;
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
  private readonly paymentPolicy?: BuyerPaymentPolicy;
  private signedAmountUnits = 0n;

  constructor(config: BuyerClientConfig) {
    this.account = privateKeyToAccount(config.privateKey);
    this.chainId = config.chainId ?? ARC_TESTNET.chainId;
    this.fetchFn = config.fetch ?? globalThis.fetch;
    this.paymentPolicy = config.paymentPolicy;
    if (this.chainId !== ARC_TESTNET.chainId) {
      throw new Error('BuyerClient currently supports Arc Testnet only');
    }
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
  async request<T = unknown>(url: string, init?: RequestInit): Promise<PaidResponse<T>> {
    // Initial request
    const initialResponse = await this.fetchFn(url, init);

    // If not 402, return directly
    if (initialResponse.status !== HTTP_402) {
      const data = (await initialResponse.json()) as T;
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

    const proposal = await this.authorizePayment(url, initialResponse, requirements);
    const paymentPayload = await this.signPayment(proposal.requirements, proposal.amountUnits);

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

    const data = (await paidResponse.json()) as T;

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
      const body = (await response.json()) as { requirements?: PaymentRequirements };
      return body.requirements ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Sign a payment authorization using EIP-3009.
   */
  private async authorizePayment(
    requestedUrl: string,
    response: globalThis.Response,
    requirements: PaymentRequirements,
  ): Promise<BuyerPaymentProposal> {
    const policy = this.paymentPolicy;
    if (!policy) {
      throw new Error('BuyerClient paymentPolicy is required before signing a 402 payment');
    }
    if (
      requirements.x402Version !== DEFAULTS.x402Version ||
      requirements.scheme !== DEFAULTS.scheme ||
      requirements.network !== DEFAULTS.network
    ) {
      throw new Error('Payment requirements do not match the supported x402 Arc Testnet profile');
    }
    if (requirements.expiry !== undefined) {
      if (!Number.isSafeInteger(requirements.expiry) || requirements.expiry <= Date.now() / 1000) {
        throw new Error('Payment requirements are expired or contain an invalid expiry');
      }
    }

    let payTo: `0x${string}`;
    try {
      payTo = getAddress(requirements.payTo);
    } catch {
      throw new Error('Payment requirements contain an invalid recipient');
    }
    const allowedPayTo = policy.allowedPayTo.map((address) => getAddress(address));
    if (allowedPayTo.length === 0 || !allowedPayTo.includes(payTo)) {
      throw new Error(`Payment recipient is not allowed: ${payTo}`);
    }

    const finalUrl = new URL(response.url || requestedUrl);
    const requestedOrigin = new URL(requestedUrl).origin;
    const allowedOrigins = (policy.allowedOrigins ?? [requestedOrigin]).map(
      (origin) => new URL(origin).origin,
    );
    if (!allowedOrigins.includes(finalUrl.origin)) {
      throw new Error(`Payment response origin is not allowed: ${finalUrl.origin}`);
    }

    const amountUnits = toStablecoinUnits(requirements.maxAmountRequired, USDC_DECIMALS);
    if (amountUnits <= 0n) throw new Error('Payment amount must be positive');
    const maxAmountUnits = toStablecoinUnits(policy.maxAmount, USDC_DECIMALS);
    const maxTotalAmountUnits = toStablecoinUnits(policy.maxTotalAmount, USDC_DECIMALS);
    if (amountUnits > maxAmountUnits) {
      throw new Error('Payment amount exceeds the per-request policy limit');
    }
    if (this.signedAmountUnits + amountUnits > maxTotalAmountUnits) {
      throw new Error('Payment amount exceeds the client total policy limit');
    }

    const normalizedRequirements = Object.freeze({ ...requirements, payTo });
    const proposal: BuyerPaymentProposal = Object.freeze({
      url: finalUrl.toString(),
      origin: finalUrl.origin,
      requirements: normalizedRequirements,
      amountUnits,
    });
    this.signedAmountUnits += amountUnits;
    try {
      if (policy.approve && !(await policy.approve(proposal))) {
        throw new Error('Payment was denied by the application approval policy');
      }
    } catch (error) {
      this.signedAmountUnits -= amountUnits;
      throw error;
    }

    return proposal;
  }

  private async signPayment(
    requirements: PaymentRequirements,
    amountUnits: bigint,
  ): Promise<PaymentPayload> {
    const now = Math.floor(Date.now() / 1000);
    const nonce =
      `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}` as `0x${string}`;

    const authorization = {
      from: this.account.address,
      to: requirements.payTo,
      value: amountUnits.toString(),
      validAfter: String(now - 60), // Valid from 1 minute ago (clock skew buffer)
      validBefore: String(now + DEFAULTS.paymentValiditySeconds),
      nonce,
    };

    // Sign the authorization using EIP-712 typed data
    if (!this.account.signTypedData) {
      throw new Error('Account does not support signTypedData');
    }
    let signature: `0x${string}`;
    try {
      signature = await this.account.signTypedData({
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
    } catch (error) {
      this.signedAmountUnits -= amountUnits;
      throw error;
    }

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
