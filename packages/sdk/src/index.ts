/**
 * @resvary/sdk
 *
 * Open-source prepaid credits and usage billing for AI products.
 *
 * @packageDocumentation
 */

export {
  createPaywallMiddleware,
  type PaywallConfig,
  type PaywallMiddleware,
} from './middleware/paywall.js';

export { expressPaywall } from './middleware/express.js';
export { nextPaywall, type NextRouteHandler } from './middleware/next.js';

export { BuyerClient, type BuyerClientConfig } from './client/buyer.js';

export { UsageMeter, type UsageRecord, type MeterConfig } from './billing/meter.js';
export {
  createBillingPlan,
  type BillingPlan,
  type PricingModel,
  type PerRequestPricing,
  type PerSecondPricing,
  type PerJobPricing,
} from './billing/plans.js';

export * from './credits/index.js';
export { createMeterDefinition, createPriceVersion, rateUsage } from './pricing/index.js';
export {
  ArcCreditFunding,
  type ArcCreditFundingConfig,
  type ArcFundingRequest,
} from './funding/index.js';

export {
  ArcWalletBalanceClient,
  GatewayClient,
  ARC_NATIVE_USDC_DECIMALS,
  type ArcWalletBalanceClientConfig,
  type GatewayClientConfig,
} from './gateway/client.js';

export {
  ReceiptWatcher,
  InMemoryReceiptStore,
  PersistentReceiptLedger,
  PersistentWebhookInbox,
  ReceiptLedger,
  WebhookInbox,
  createInvoice,
  createInvoiceMemo,
  createMemoPaymentRequest,
  createReceipt,
  createWebhookRouteHandler,
  createWatcherCursorKey,
  findMemoPaymentProof,
  parseReceiptStoreValue,
  serializeReceiptStoreValue,
  signWebhookEvent,
  verifyMemoPaymentProof,
  verifyWebhookSignature,
  type PaymentInvoice,
  type PaymentReceipt,
  type ReceiptOnchainProof,
  type ReceiptWatcherConfig,
  type CreateInvoiceInput,
  type FindMemoPaymentProofInput,
  type FindMemoPaymentProofResult,
  type PersistentReceiptLedgerConfig,
  type PersistentWebhookInboxConfig,
  type MemoPaymentRequest,
  type ObservedPayment,
  type ProofClient,
  type ProofMemoLog,
  type ProofPollingClient,
  type ReceiptStore,
  type ReceiptStoreDeliveryFilter,
  type ReceiptStoreEventFilter,
  type ReceiptStoreInvoiceFilter,
  type ProofTransactionReceipt,
  type ReceiptWatcherClient,
  type VerifyMemoPaymentProofInput,
  type VerifyMemoPaymentProofResult,
  type WatcherCursor,
  type WatcherCursorKeyInput,
  type WebhookDeliveryAttempt,
  type WebhookDeliveryStatus,
  type WebhookEvent,
  type WebhookRouteHandlerConfig,
  type WebhookRouteResult,
} from './receipts/index.js';

export { ARC_TESTNET, ARC_TESTNET_CONTRACTS, USDC_DECIMALS } from './constants.js';

export type {
  PaymentRequirements,
  PaymentPayload,
  PaymentResult,
  X402Version,
  NetworkConfig,
} from './types.js';
