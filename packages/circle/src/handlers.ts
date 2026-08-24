import { createHash } from 'node:crypto';
import {
  GatewayNanopaymentFunding,
  type GatewayFundingResult,
  type GatewayPaymentPayload,
} from './nanopayments.js';

export interface GatewayTopUpRequest {
  customerId: string;
  amount: string;
  idempotencyKey: string;
  expectedPayer?: `0x${string}`;
  metadata?: Record<string, unknown>;
}

export interface GatewayTopUpHandlerConfig {
  funding: GatewayNanopaymentFunding;
  enabled?: boolean | (() => boolean);
  disabledMessage?: string;
  resolveRequest(request: Request): GatewayTopUpRequest | Promise<GatewayTopUpRequest>;
}

export type GatewayTopUpHandler = (request: Request) => Promise<Response>;

export function createGatewayTopUpHandler(config: GatewayTopUpHandlerConfig): GatewayTopUpHandler {
  return async (request) => {
    const enabled =
      typeof config.enabled === 'function' ? config.enabled() : (config.enabled ?? true);
    if (!enabled) {
      return Response.json(
        {
          error:
            config.disabledMessage ??
            'Circle Gateway Testnet top-up is disabled for this deployment',
        },
        {
          status: 503,
          headers: { 'cache-control': 'private, no-store' },
        },
      );
    }

    const paymentHeader = request.headers.get('payment-signature');
    if (!paymentHeader) {
      try {
        const input = await config.resolveRequest(request);
        const fundingRequest = await config.funding.createFundingRequest(input);
        return Response.json(
          {
            error: 'Payment required',
            fundingIntentId: fundingRequest.fundingIntent.id,
          },
          {
            status: 402,
            headers: {
              'payment-required': encodeHeader(fundingRequest.paymentRequired),
              'cache-control': 'private, no-store',
            },
          },
        );
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Invalid Gateway top-up request' },
          {
            status: 400,
            headers: { 'cache-control': 'private, no-store' },
          },
        );
      }
    }

    try {
      const paymentPayload = decodePaymentPayload(paymentHeader);
      const fundingIntentId = paymentPayload.accepted?.extra?.resvaryFundingIntentId;
      if (typeof fundingIntentId !== 'string' || fundingIntentId.length === 0) {
        throw new Error('Payment payload has no Resvary funding intent binding');
      }
      const nonce = paymentPayload.payload?.authorization?.nonce;
      const idempotencyKey = `gateway-http:${createHash('sha256')
        .update(`${fundingIntentId}\0${String(nonce ?? '')}`)
        .digest('hex')}`;
      const result = await config.funding.verifySettleAndCredit({
        fundingIntentId,
        paymentPayload,
        idempotencyKey,
        metadata: { transport: 'x402-http' },
      });
      return fundingResultResponse(result);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Gateway top-up failed' },
        {
          status: 409,
          headers: { 'cache-control': 'private, no-store' },
        },
      );
    }
  };
}

export function createNextGatewayTopUpHandler(
  config: GatewayTopUpHandlerConfig,
): GatewayTopUpHandler {
  return createGatewayTopUpHandler(config);
}

export interface ExpressLikeRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  protocol?: string;
  get?(name: string): string | undefined;
}

export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

export function createExpressGatewayTopUpHandler(
  config: GatewayTopUpHandlerConfig,
): (request: ExpressLikeRequest, response: ExpressLikeResponse) => Promise<void> {
  const handler = createGatewayTopUpHandler(config);
  return async (request, response) => {
    const host = request.get?.('host') ?? firstHeader(request.headers.host) ?? 'localhost';
    const protocol = request.protocol ?? 'http';
    const url = new URL(request.originalUrl ?? request.url ?? '/', `${protocol}://${host}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) headers.set(name, value.join(', '));
      else if (typeof value === 'string') headers.set(name, value);
    }
    const method = request.method ?? 'POST';
    const webRequest = new Request(url, {
      method,
      headers,
      body:
        method === 'GET' || method === 'HEAD' || request.body === undefined
          ? undefined
          : JSON.stringify(request.body),
    });
    const result = await handler(webRequest);
    result.headers.forEach((value, name) => response.setHeader(name, value));
    response.status(result.status).json(await result.json());
  };
}

function fundingResultResponse(result: GatewayFundingResult): Response {
  const body = {
    fundingIntent: result.fundingIntent,
    fundingTransaction: result.fundingTransaction,
    grant: result.grant,
    balance: result.account,
    replayed: result.replayed,
  };
  return Response.json(body, {
    status: 200,
    headers: {
      'payment-response': encodeHeader(result.settlement),
      'cache-control': 'private, no-store',
    },
  });
}

function decodePaymentPayload(header: string): GatewayPaymentPayload {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    throw new Error('Payment-Signature is not valid base64 JSON');
  }
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Payment-Signature payload must be an object');
  }
  return decoded as GatewayPaymentPayload;
}

function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
