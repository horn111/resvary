/**
 * Arc transaction memo helpers for invoice correlation.
 */

import { keccak256, stringToHex } from 'viem';

export interface ParsedInvoiceMemo {
  namespace: string;
  version: 'v1';
  kind: 'invoice';
  invoiceId: string;
}

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

export function createInvoiceMemo(invoiceId: string, namespace = 'resvary'): string {
  const cleanInvoiceId = invoiceId.trim();
  const cleanNamespace = namespace.trim();

  if (!SAFE_ID.test(cleanInvoiceId)) {
    throw new Error('Invoice id can only contain letters, numbers, underscores, and dashes');
  }

  if (!SAFE_ID.test(cleanNamespace)) {
    throw new Error('Memo namespace can only contain letters, numbers, underscores, and dashes');
  }

  return `${cleanNamespace}:invoice:v1:${cleanInvoiceId}`;
}

export function createInvoiceMemoId(invoiceId: string): `0x${string}` {
  return keccak256(stringToHex(invoiceId));
}

export function createInvoiceMemoData(memo: string): `0x${string}` {
  return stringToHex(memo);
}

export function parseInvoiceMemo(memo: string): ParsedInvoiceMemo | null {
  const [namespace, kind, version, invoiceId, ...extra] = memo.split(':');

  if (
    !namespace
    || kind !== 'invoice'
    || version !== 'v1'
    || !invoiceId
    || extra.length > 0
  ) {
    return null;
  }

  return {
    namespace,
    kind,
    version,
    invoiceId,
  };
}
