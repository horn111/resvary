/**
 * Framework-agnostic paywall configuration.
 */

import type { EndpointConfig, PaymentPayload, PaymentRequirements } from '../types.js';
import { DEFAULTS, USDC_DECIMALS, X402_HEADER } from '../constants.js';

/** Configuration for the paywall middleware */
export interface PaywallConfig extends EndpointConfig {
  /** Seller's wallet address to receive payments */
  payTo?: `0x${string}`;
  /** Custom logger */
  logger?: {
    info: (msg: string, data?: unknown) => void;
    error: (msg: string, data?: unknown) => void;
  };
}

/** Generic middleware function type */
export type PaywallMiddleware = (config: PaywallConfig) => {
  /** Generate payment requirements for a 402 response */
  getPaymentRequirements: () => PaymentRequirements;
  /** Parse payment payload from request headers */
  parsePayment: (headers: Record<string, string | undefined>) => PaymentPayload | null;
  /** Verify a payment payload */
  verifyPayment: (payload: PaymentPayload) => Promise<boolean>;
};

/**
 * Create a framework-agnostic paywall handler.
 *
 * @param config - Paywall configuration including price and network
 * @returns Paywall handler with methods for 402 flow
 *
 * @example
 * ```typescript
 * const paywall = createPaywallMiddleware({
 *   price: '0.001',
 *   network: 'arc-testnet',
 *   description: 'Premium data endpoint',
 * });
 * ```
 */
export function createPaywallMiddleware(config: PaywallConfig) {
  const {
    price,
    network = DEFAULTS.network,
    scheme = DEFAULTS.scheme,
    description,
    payTo,
    logger = { info: () => {}, error: () => {} },
  } = config;

  const sellerAddress = payTo ?? (process.env.SELLER_ADDRESS as `0x${string}` | undefined);

  if (!sellerAddress) {
    throw new Error(
      'resvary: Seller address is required. Set SELLER_ADDRESS env var or pass payTo in config.',
    );
  }

  return {
    /**
     * Generate payment requirements for a 402 response.
     */
    getPaymentRequirements(): PaymentRequirements {
      return {
        x402Version: DEFAULTS.x402Version as 2,
        scheme: scheme as 'exact',
        network,
        maxAmountRequired: price,
        payTo: sellerAddress,
        description,
        expiry: Math.floor(Date.now() / 1000) + DEFAULTS.paymentValiditySeconds,
      };
    },

    /**
     * Parse payment payload from request headers.
     */
    parsePayment(headers: Record<string, string | undefined>): PaymentPayload | null {
      const paymentHeader = headers[X402_HEADER] ?? headers[X402_HEADER.toUpperCase()];

      if (!paymentHeader) {
        return null;
      }

      try {
        const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
        return JSON.parse(decoded) as PaymentPayload;
      } catch (error) {
        logger.error('Failed to parse payment header', error);
        return null;
      }
    },

    /**
     * Verify a payment payload.
     * In production, this delegates to Circle Gateway for verification.
     */
    async verifyPayment(payload: PaymentPayload): Promise<boolean> {
      if (config.verifyPayment) {
        const result = await config.verifyPayment(payload);
        return result.success;
      }

      // Verify basic payment structure
      if (!payload.payload?.signature || !payload.payload?.authorization) {
        logger.error('Invalid payment payload structure');
        return false;
      }

      // Verify payment amount meets minimum
      const paymentAmount = BigInt(payload.payload.authorization.value);
      const requiredAmount = BigInt(Math.floor(parseFloat(price) * 10 ** USDC_DECIMALS));

      if (paymentAmount < requiredAmount) {
        logger.error('Payment amount insufficient', {
          received: paymentAmount.toString(),
          required: requiredAmount.toString(),
        });
        return false;
      }

      // Verify payment is addressed to seller
      if (payload.payload.authorization.to.toLowerCase() !== sellerAddress.toLowerCase()) {
        logger.error('Payment not addressed to seller');
        return false;
      }

      // Verify payment hasn't expired
      const now = Math.floor(Date.now() / 1000);
      const validBefore = parseInt(payload.payload.authorization.validBefore, 10);

      if (now > validBefore) {
        logger.error('Payment authorization has expired');
        return false;
      }

      logger.info('Payment verified successfully', {
        from: payload.payload.authorization.from,
        amount: payload.payload.authorization.value,
      });

      return true;
    },
  };
}
