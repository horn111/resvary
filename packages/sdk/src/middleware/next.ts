/**
 * Next.js App Router middleware for x402 paywalled endpoints.
 *
 * @example
 * ```typescript
 * // app/api/data/route.ts
 * import { nextPaywall } from '@resvary/sdk/middleware';
 *
 * export const GET = nextPaywall(
 *   { price: '0.001' },
 *   async (request) => {
 *     return Response.json({ data: 'premium content' });
 *   }
 * );
 * ```
 */

import { createPaywallMiddleware, type PaywallConfig } from './paywall.js';
import { HTTP_402, PAYMENT_REQUIRED_HEADER } from '../constants.js';

type NextRequest = Request;
export type NextRouteHandler = (request: Request) => Promise<Response> | Response;

/**
 * Wrap a Next.js route handler with x402 paywall protection.
 *
 * @param config - Paywall configuration
 * @param handler - The route handler to protect
 * @returns A new route handler that enforces payment
 */
export function nextPaywall(config: PaywallConfig, handler: NextRouteHandler): NextRouteHandler {
  const paywall = createPaywallMiddleware(config);

  return async (request: NextRequest): Promise<Response> => {
    // Extract headers
    const headers: Record<string, string | undefined> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Try to parse payment
    const payment = paywall.parsePayment(headers);

    if (!payment) {
      // Return 402 with payment requirements
      const requirements = paywall.getPaymentRequirements();
      const encoded = Buffer.from(JSON.stringify(requirements)).toString('base64');

      return new Response(
        JSON.stringify({
          error: 'Payment Required',
          message: `This endpoint requires a payment of ${config.price} USDC`,
          requirements,
        }),
        {
          status: HTTP_402,
          headers: {
            'Content-Type': 'application/json',
            [PAYMENT_REQUIRED_HEADER]: encoded,
          },
        },
      );
    }

    // Verify payment
    const isValid = await paywall.verifyPayment(payment);

    if (!isValid) {
      return new Response(
        JSON.stringify({
          error: 'Payment Invalid',
          message: 'The provided payment could not be verified',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Payment verified — call the handler
    return handler(request);
  };
}
