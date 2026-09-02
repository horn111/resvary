export type CreditCurrency = 'USD';
export type CreditGrantSource =
  | 'manual'
  | 'migration'
  | 'arc'
  | 'circle_gateway_nanopayment'
  | 'allowance'
  | 'promotion';
export type CreditGrantPolicyType = 'allowance' | 'promotion';
export type AllowanceCadence = 'day' | 'week' | 'month';
export type CreditLotKind = 'legacy' | 'general' | 'allowance' | 'promotion';
export type FundingRail = 'arc_direct' | 'circle_gateway_nanopayment';
export type FundingIntentStatus = 'pending' | 'confirmed' | 'failed';
export type FundingSettlementStatus = 'accepted' | 'settled' | 'failed' | 'reconciliation_required';
export type ReservationStatus = 'open' | 'committed' | 'released' | 'expired';
export type LedgerEntryType = 'grant' | 'adjustment' | 'reserve' | 'release' | 'charge' | 'expire';
export type LedgerBucket = 'posted' | 'reserved';
export type CreditEventType =
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

export type OutboxEventStatus = 'pending' | 'processing' | 'delivered' | 'dead_letter';

export interface FundingEvidence {
  authorizationHash?: `0x${string}`;
  nonce?: `0x${string}`;
  payer?: `0x${string}`;
  recipient?: `0x${string}`;
  amountUnits: string;
  facilitatorReference?: string;
  explorerUrl?: string;
  blockNumber?: string;
  metadata?: Record<string, unknown>;
}

export interface CreditAccountKey {
  projectId: string;
  customerId: string;
  currency?: CreditCurrency;
}

export interface CreditAccount {
  id: string;
  projectId: string;
  customerId: string;
  currency: CreditCurrency;
  postedUnits: string;
  reservedUnits: string;
  availableUnits: string;
  postedAmount: string;
  reservedAmount: string;
  availableAmount: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface CreditGrant {
  id: string;
  accountId: string;
  projectId: string;
  customerId: string;
  amount: string;
  amountUnits: string;
  source: CreditGrantSource;
  externalRef?: string;
  policyId?: string;
  expiresAt?: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

interface CreditGrantPolicyBase {
  id: string;
  projectId: string;
  key: string;
  version: number;
  type: CreditGrantPolicyType;
  amount: string;
  amountUnits: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface AllowanceGrantPolicy extends CreditGrantPolicyBase {
  type: 'allowance';
  cadence: AllowanceCadence;
}

export interface PromotionGrantPolicy extends CreditGrantPolicyBase {
  type: 'promotion';
  expiresInMs: number;
}

export type CreditGrantPolicy = AllowanceGrantPolicy | PromotionGrantPolicy;

export interface CreditLot {
  id: string;
  accountId: string;
  projectId: string;
  customerId: string;
  kind: CreditLotKind;
  grantId?: string;
  policyId?: string;
  originalAmount: string;
  originalUnits: string;
  availableAmount: string;
  availableUnits: string;
  reservedAmount: string;
  reservedUnits: string;
  consumedAmount: string;
  consumedUnits: string;
  expiredAmount: string;
  expiredUnits: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface CreditLotAllocation {
  id: string;
  reservationId: string;
  lotId: string;
  accountId: string;
  projectId: string;
  customerId: string;
  allocatedAmount: string;
  allocatedUnits: string;
  reservedAmount: string;
  reservedUnits: string;
  consumedAmount: string;
  consumedUnits: string;
  releasedAmount: string;
  releasedUnits: string;
  expiredAmount: string;
  expiredUnits: string;
  createdAt: number;
  updatedAt: number;
}

export interface GrantPolicyApplication {
  id: string;
  policyId: string;
  policyType: CreditGrantPolicyType;
  accountId: string;
  projectId: string;
  customerId: string;
  periodKey: string;
  grantId?: string;
  grantedAmount: string;
  grantedUnits: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface MeterDefinition {
  id: string;
  projectId: string;
  key: string;
  name: string;
  dimensions: string[];
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface PriceRateInput {
  dimension: string;
  unitSize: string;
  amount: string;
}

export interface PriceRate extends PriceRateInput {
  amountUnits: string;
}

export interface GraduatedPriceTierInput {
  unitSize: string;
  amount: string;
  upTo?: string;
}

export interface GraduatedPriceTier extends GraduatedPriceTierInput {
  amountUnits: string;
}

export interface GraduatedPriceComponentInput {
  model: 'graduated';
  dimension: string;
  tiers: GraduatedPriceTierInput[];
}

export interface GraduatedPriceComponent {
  model: 'graduated';
  dimension: string;
  tiers: GraduatedPriceTier[];
}

export interface PackagePriceComponentInput {
  model: 'package';
  dimension: string;
  packageSize: string;
  amount: string;
}

export interface PackagePriceComponent extends PackagePriceComponentInput {
  amountUnits: string;
}

export type PriceComponentInput = GraduatedPriceComponentInput | PackagePriceComponentInput;
export type PriceComponent = GraduatedPriceComponent | PackagePriceComponent;

export interface PriceVersion {
  id: string;
  projectId: string;
  meterId: string;
  meterKey: string;
  version: number;
  currency: CreditCurrency;
  rates: PriceRate[];
  components?: PriceComponent[];
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export type UsageQuantities = Record<string, string>;

export interface RatedLineItem {
  dimension: string;
  quantity: string;
  unitSize: string;
  rateAmount: string;
  rateUnits: string;
  amount: string;
  amountUnits: string;
  pricingModel?: 'graduated' | 'package';
  tierIndex?: number;
  tierFrom?: string;
  tierUpTo?: string;
  packageSize?: string;
  packageCount?: string;
}

export interface RatedUsage {
  priceId: string;
  totalAmount: string;
  totalUnits: string;
  lineItems: RatedLineItem[];
}

export interface CreditReservation {
  id: string;
  accountId: string;
  projectId: string;
  customerId: string;
  priceId: string;
  status: ReservationStatus;
  estimatedUsage: UsageQuantities;
  reservedAmount: string;
  reservedUnits: string;
  committedAmount?: string;
  committedUnits?: string;
  releasedAmount?: string;
  releasedUnits?: string;
  usageReceiptId?: string;
  createdAt: number;
  expiresAt: number;
  closedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface UsageEvent {
  id: string;
  accountId: string;
  projectId: string;
  customerId: string;
  reservationId: string;
  priceId: string;
  quantities: UsageQuantities;
  occurredAt: number;
  receivedAt: number;
  metadata?: Record<string, unknown>;
}

export interface UsageReceipt {
  id: string;
  accountId: string;
  projectId: string;
  customerId: string;
  reservationId: string;
  usageEventId: string;
  priceId: string;
  currency: CreditCurrency;
  amount: string;
  amountUnits: string;
  releasedAmount: string;
  releasedUnits: string;
  lineItems: RatedLineItem[];
  balanceBeforeUnits: string;
  balanceAfterUnits: string;
  createdAt: number;
  allocations?: CreditLotAllocation[];
  metadata?: Record<string, unknown>;
}

export interface LedgerEntry {
  id: string;
  accountId: string;
  projectId: string;
  customerId: string;
  type: LedgerEntryType;
  bucket: LedgerBucket;
  deltaUnits: string;
  balanceAfterUnits: string;
  referenceType:
    | 'grant'
    | 'adjustment'
    | 'reservation'
    | 'usage_receipt'
    | 'funding'
    | 'credit_lot'
    | 'grant_policy';
  referenceId: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface CreditOutboxEvent<TData = unknown> {
  id: string;
  projectId: string;
  type: CreditEventType;
  data: TData;
  status: OutboxEventStatus;
  createdAt: number;
  attemptCount: number;
  nextAttemptAt: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
  deliveredAt?: number;
}

export interface IdempotencyRecord {
  scope: string;
  key: string;
  requestHash: string;
  result: unknown;
  createdAt: number;
}

export interface FundingIntent {
  id: string;
  projectId: string;
  customerId: string;
  accountId: string;
  status: FundingIntentStatus;
  requestedAmount: string;
  requestedUnits: string;
  rail: FundingRail;
  network: string;
  invoiceId: string;
  createdAt: number;
  expiresAt?: number;
  confirmedAt?: number;
  failedAt?: number;
  failureReason?: string;
  metadata?: Record<string, unknown>;
}

export interface FundingTransaction {
  id: string;
  fundingIntentId: string;
  projectId: string;
  customerId: string;
  accountId: string;
  rail: FundingRail;
  network: string;
  externalPaymentId: string;
  txHash?: `0x${string}`;
  amount: string;
  amountUnits: string;
  paymentReceiptId: string;
  grantId: string;
  payer?: `0x${string}`;
  settlementStatus: FundingSettlementStatus;
  acceptedAt: number;
  settledAt?: number;
  evidence: FundingEvidence;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface CreditBalanceFilter {
  projectId?: string;
  customerId?: string;
}

export interface OutboxEventFilter {
  projectId?: string;
  status?: CreditOutboxEvent['status'];
  type?: CreditEventType;
}

export interface CreditLotFilter extends CreditBalanceFilter {
  policyId?: string;
  kind?: CreditLotKind;
  expiresBefore?: number;
}

export interface GrantPolicyApplicationFilter extends CreditBalanceFilter {
  policyId?: string;
  policyType?: CreditGrantPolicyType;
  periodKey?: string;
}
