import { MemoPaymentProofError } from '@resvary/sdk/receipts';

export function jsonSafeResponse(value: unknown, init?: ResponseInit): Response {
  return Response.json(toJsonSafeValue(value), init);
}

export function proofErrorResponse(
  error: unknown,
  fallbackMessage: string,
  fallbackReason: string,
): Response {
  if (error instanceof MemoPaymentProofError) {
    return Response.json({ error: error.message, reason: error.reason }, { status: 422 });
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  return Response.json({ error: message, reason: fallbackReason }, { status: 500 });
}

function toJsonSafeValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  const json = JSON.stringify(value, jsonSafeReplacer);
  return json === undefined ? undefined : JSON.parse(json);
}

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
