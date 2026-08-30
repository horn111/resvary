/**
 * Types for Resvary invoice, receipt, and webhook workflows.
 */

export type StablecoinSymbol = 'USDC' | 'EURC';

export type InvoiceStatus = 'open' | 'observed' | 'paid' | 'expired' | 'refunded' | 'void';

export type ReceiptStatus = 'paid' | 'refunded';

export interface CreateInvoiceInput {
  /** Optional deterministic invoice id. A random id is generated when omitted. */
  id?: string;
  /** Human-readable stablecoin amount, e.g. "19.00". */
  amount: string;
  /** Stablecoin symbol. Defaults to USDC. */
  currency?: StablecoinSymbol;
  /** Seller wallet receiving the payment. */
  payTo: `0x${string}`;
  /** Arc network identifier. Defaults to arc-testnet. */
  network?: string;
  /** Optional customer/user id from the seller application. */
  customerId?: string;
  /** Optional invoice description. */
  description?: string;
  /** Unix timestamp in milliseconds. */
  createdAt?: number;
  /** Unix timestamp in milliseconds. */
  expiresAt?: number;
  /** Optional metadata copied into receipts and webhooks. */
  metadata?: Record<string, unknown>;
}

export interface PaymentInvoice {
  id: string;
  status: InvoiceStatus;
  amount: string;
  amountUnits: string;
  currency: StablecoinSymbol;
  payTo: `0x${string}`;
  network: string;
  memo: string;
  memoId?: `0x${string}`;
  memoData?: `0x${string}`;
  paymentUri: string;
  createdAt: number;
  expiresAt?: number;
  customerId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ObservedPayment {
  txHash?: `0x${string}`;
  from?: `0x${string}`;
  to: `0x${string}`;
  amount: string;
  currency?: StablecoinSymbol;
  network?: string;
  memo?: string;
  memoId?: `0x${string}`;
  callDataHash?: `0x${string}`;
  observedAt?: number;
  blockNumber?: bigint;
  onchainProof?: ReceiptOnchainProof;
  metadata?: Record<string, unknown>;
}

export interface MemoPaymentRequest {
  invoiceId: string;
  memoContract: `0x${string}`;
  target: `0x${string}`;
  data: `0x${string}`;
  txData: `0x${string}`;
  memoId: `0x${string}`;
  memoData: `0x${string}`;
  callDataHash: `0x${string}`;
  amountUnits: string;
  payTo: `0x${string}`;
}

export interface PaymentMatchResult {
  success: boolean;
  reason?: string;
}

export interface PaymentReceipt {
  id: string;
  invoiceId: string;
  status: ReceiptStatus;
  amount: string;
  amountUnits: string;
  currency: StablecoinSymbol;
  network: string;
  payTo: `0x${string}`;
  payer?: `0x${string}`;
  memo: string;
  txHash?: `0x${string}`;
  createdAt: number;
  blockNumber?: bigint;
  onchainProof?: ReceiptOnchainProof;
  metadata?: Record<string, unknown>;
}

export interface ReceiptOnchainProof {
  chainId: number;
  network: string;
  txHash: `0x${string}`;
  blockNumber: bigint;
  transactionIndex?: number;
  logIndex?: number;
  memoContract: `0x${string}`;
  memoIndex?: string;
  memoId: `0x${string}`;
  callDataHash: `0x${string}`;
  payer: `0x${string}`;
  payTo: `0x${string}`;
  target: `0x${string}`;
  amountUnits: string;
  explorerUrl: string;
  verifiedAt: number;
}

export type WebhookEventType =
  | 'invoice.created'
  | 'invoice.observed'
  | 'invoice.paid'
  | 'invoice.expired'
  | 'invoice.refunded'
  | 'credit.granted'
  | 'credit.adjusted'
  | 'credit.reserved'
  | 'credit.released'
  | 'credit.expired'
  | 'credit.policy.created'
  | 'credit.allowance.applied'
  | 'credit.promotion.claimed'
  | 'credit.lot.expired'
  | 'usage.charged'
  | 'funding.intent.created'
  | 'funding.accepted'
  | 'funding.confirmed'
  | 'funding.settled'
  | 'funding.reconciliation_required'
  | 'funding.failed';

export interface WebhookEvent<TData = unknown> {
  id: string;
  type: WebhookEventType;
  createdAt: number;
  data: TData;
}

export type WebhookDeliveryStatus = 'verified' | 'failed';

export interface WebhookDeliveryAttempt {
  id: string;
  eventId: string;
  eventType: WebhookEventType | 'unknown';
  attempt: number;
  status: WebhookDeliveryStatus;
  verified: boolean;
  signatureHeader: string;
  receivedAt: number;
  target?: string;
  replayOf?: string;
  error?: string;
}
