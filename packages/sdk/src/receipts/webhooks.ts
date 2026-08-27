/**
 * Signed webhook helpers for invoice and receipt events.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { serializeReceiptStoreValue } from './serialization.js';
import type { WebhookEvent, WebhookEventType } from './types.js';

export interface WebhookSignature {
  timestamp: number;
  signature: string;
  header: string;
}

export function createWebhookEvent<TData>(
  type: WebhookEventType,
  data: TData,
  createdAt = Date.now(),
): WebhookEvent<TData> {
  return {
    id: `evt_${randomBytes(12).toString('hex')}`,
    type,
    createdAt,
    data,
  };
}

export function signWebhookEvent(
  event: WebhookEvent,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): WebhookSignature {
  const payload = serializeWebhookPayload(event);
  const signature = createWebhookSignature(payload, secret, timestamp);

  return {
    timestamp,
    signature,
    header: `t=${timestamp},v1=${signature}`,
  };
}

export function verifyWebhookSignature(params: {
  payload: WebhookEvent | string;
  header: string;
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}): boolean {
  const parsed = parseWebhookSignatureHeader(params.header);
  if (!parsed) {
    return false;
  }

  const now = params.now ?? Math.floor(Date.now() / 1000);
  const toleranceSeconds = params.toleranceSeconds ?? 300;
  if (Math.abs(now - parsed.timestamp) > toleranceSeconds) {
    return false;
  }

  const payload =
    typeof params.payload === 'string' ? params.payload : serializeWebhookPayload(params.payload);
  const expected = createWebhookSignature(payload, params.secret, parsed.timestamp);

  return timingSafeStringEqual(expected, parsed.signature);
}

export function serializeWebhookPayload(event: WebhookEvent): string {
  return serializeReceiptStoreValue(event);
}

function createWebhookSignature(payload: string, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
}

function parseWebhookSignatureHeader(
  header: string,
): { timestamp: number; signature: string } | null {
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    }),
  );

  if (!parts.t || !parts.v1) {
    return null;
  }

  const timestamp = Number(parts.t);
  if (!Number.isSafeInteger(timestamp)) {
    return null;
  }

  return {
    timestamp,
    signature: parts.v1,
  };
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}
