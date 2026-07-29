/**
 * Express.js middleware for x402 paywalled endpoints.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { expressPaywall } from '@settlary/sdk/middleware';
 *
 * const app = express();
 *
 * app.get('/api/data', expressPaywall({ price: '0.001' }), (req, res) => {
 *   res.json({ data: 'premium content' });
 * });
 * ```
 */

import type { Request, Response, NextFunction } from 'express';
import { createPaywallMiddleware, type PaywallConfig } from './paywall.js';
import { HTTP_402, PAYMENT_REQUIRED_HEADER } from '../constants.js';

/**
 * Create Express middleware that gates an endpoint behind an x402 paywall.
 *
 * @param config - Paywall configuration
 * @returns Express middleware function
 */
export function expressPaywall(config: PaywallConfig) {
  const paywall = createPaywallMiddleware(config);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Extract headers as a simple record
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
    }

    // Try to parse payment from headers
    const payment = paywall.parsePayment(headers);

    if (!payment) {
      // No payment provided — return 402 with requirements
      const requirements = paywall.getPaymentRequirements();
      const encoded = Buffer.from(JSON.stringify(requirements)).toString('base64');

      res
        .status(HTTP_402)
        .set(PAYMENT_REQUIRED_HEADER, encoded)
        .json({
          error: 'Payment Required',
          message: `This endpoint requires a payment of ${config.price} USDC`,
          requirements,
        });
      return;
    }

    // Verify the payment
    const isValid = await paywall.verifyPayment(payment);

    if (!isValid) {
      res.status(403).json({
        error: 'Payment Invalid',
        message: 'The provided payment could not be verified',
      });
      return;
    }

    // Payment verified — proceed to handler
    next();
  };
}
