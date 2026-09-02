import { createHash, randomBytes } from 'node:crypto';
import { creditUnitsToString, parseCreditUnits, toCreditUnits } from './amount.js';
import {
  CreditNotFoundError,
  IdempotencyConflictError,
  InsufficientCreditsError,
  InvalidCreditStateError,
  UnsupportedCreditStoreCapabilityError,
} from './errors.js';
import {
  InMemoryCreditStore,
  isCreditPolicyStore,
  type CreditPolicyStore,
  type CreditPolicyStoreTransaction,
  type CreditStore,
  type CreditStoreTransaction,
} from './store.js';
import type {
  AllowanceCadence,
  AllowanceGrantPolicy,
  CreditAccount,
  CreditEventType,
  CreditGrant,
  CreditGrantPolicy,
  CreditGrantSource,
  CreditLot,
  CreditLotAllocation,
  CreditLotFilter,
  CreditLotKind,
  FundingEvidence,
  FundingIntent,
  FundingRail,
  FundingSettlementStatus,
  FundingTransaction,
  GrantPolicyApplication,
  GrantPolicyApplicationFilter,
  CreditOutboxEvent,
  CreditReservation,
  LedgerBucket,
  LedgerEntry,
  LedgerEntryType,
  MeterDefinition,
  OutboxEventFilter,
  PriceComponentInput,
  PriceRateInput,
  PriceVersion,
  PromotionGrantPolicy,
  UsageEvent,
  UsageQuantities,
  UsageReceipt,
} from './types.js';
import { createMeterDefinition, createPriceVersion, rateUsage } from '../pricing/rating.js';

export interface CreditLedgerConfig {
  projectId: string;
  store?: CreditStore;
  reservationTtlMs?: number;
  now?: () => number;
}

export interface EnsureAccountInput {
  customerId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface GrantCreditsInput extends EnsureAccountInput {
  amount: string;
  source?: CreditGrantSource;
  externalRef?: string;
}

interface CreateGrantPolicyInputBase {
  key: string;
  amount: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAllowanceGrantPolicyInput extends CreateGrantPolicyInputBase {
  type: 'allowance';
  cadence: AllowanceCadence;
}

export interface CreatePromotionGrantPolicyInput extends CreateGrantPolicyInputBase {
  type: 'promotion';
  expiresInMs: number;
}

export type CreateGrantPolicyInput =
  | CreateAllowanceGrantPolicyInput
  | CreatePromotionGrantPolicyInput;

export interface ApplyAllowanceInput extends EnsureAccountInput {
  policyId: string;
}

export interface ClaimPromotionInput extends EnsureAccountInput {
  policyId: string;
}

export interface GrantPolicyResult {
  policy: CreditGrantPolicy;
  application: GrantPolicyApplication;
  account: CreditAccount;
  grant?: CreditGrant;
}

export interface SweepExpiredCreditLotsInput {
  customerId?: string;
  before?: number;
  limit?: number;
}

export interface SweepExpiredCreditLotsResult {
  lots: CreditLot[];
  accounts: CreditAccount[];
}

export interface AdjustCreditsInput extends EnsureAccountInput {
  amount: string;
  reason: string;
}

export interface RegisterMeterInput {
  key: string;
  name?: string;
  dimensions: string[];
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePriceVersionInput {
  meterKey: string;
  rates: PriceRateInput[];
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAdvancedPriceVersionInput {
  meterKey: string;
  components: PriceComponentInput[];
  rates?: PriceRateInput[];
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface ReserveCreditsInput extends EnsureAccountInput {
  priceId: string;
  estimatedUsage: UsageQuantities;
  expiresAt?: number;
}

export interface CommitUsageInput {
  reservationId: string;
  usageEventId: string;
  actualUsage: UsageQuantities;
  idempotencyKey: string;
  occurredAt?: number;
  metadata?: Record<string, unknown>;
}

export interface ReleaseReservationInput {
  reservationId: string;
  idempotencyKey: string;
  reason?: string;
}

export interface RunMeteredInput extends ReserveCreditsInput {}

export interface RunMeteredCallbackResult<T> {
  value: T;
  actualUsage: UsageQuantities;
  usageEventId: string;
  occurredAt?: number;
  metadata?: Record<string, unknown>;
}

export interface RunMeteredResult<T> {
  value?: T;
  replayed: boolean;
  reservation: CreditReservation;
  receipt: UsageReceipt;
  balance: CreditAccount;
}

export interface CreateFundingIntentInput extends EnsureAccountInput {
  id?: string;
  amount: string;
  rail?: FundingRail;
  network: string;
  invoiceId: string;
  expiresAt?: number;
}

export interface ConfirmFundingInput {
  fundingIntentId: string;
  rail?: FundingRail;
  network: string;
  externalPaymentId?: string;
  txHash?: `0x${string}`;
  amount: string;
  paymentReceiptId: string;
  payer?: `0x${string}`;
  settlementStatus?: Extract<FundingSettlementStatus, 'accepted' | 'settled'>;
  settledAt?: number;
  requireExactAmount?: boolean;
  evidence?: Omit<FundingEvidence, 'amountUnits'>;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateFundingSettlementInput {
  fundingTransactionId: string;
  status: Extract<FundingSettlementStatus, 'settled' | 'reconciliation_required'>;
  idempotencyKey: string;
  settledAt?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface FailFundingIntentInput {
  fundingIntentId: string;
  reason: string;
  idempotencyKey: string;
}

export class CreditLedger {
  readonly projectId: string;
  readonly store: CreditStore;
  private readonly reservationTtlMs: number;
  private readonly now: () => number;

  constructor(config: CreditLedgerConfig) {
    this.projectId = requireText(config.projectId, 'projectId');
    this.store = config.store ?? new InMemoryCreditStore();
    this.reservationTtlMs = config.reservationTtlMs ?? 15 * 60 * 1000;
    this.now = config.now ?? Date.now;
    if (!Number.isSafeInteger(this.reservationTtlMs) || this.reservationTtlMs <= 0) {
      throw new Error('reservationTtlMs must be a positive integer');
    }
  }

  async ensureAccount(input: EnsureAccountInput): Promise<CreditAccount> {
    const request = { customerId: input.customerId, metadata: input.metadata };
    return this.store.transaction((tx) =>
      this.idempotent(tx, 'ensure_account', input.idempotencyKey, request, async () =>
        this.ensureAccountInTransaction(tx, input.customerId, input.metadata),
      ),
    );
  }

  async createGrantPolicy(input: CreateGrantPolicyInput): Promise<CreditGrantPolicy> {
    const store = this.requirePolicyStore();
    const amountUnits = toCreditUnits(input.amount);
    if (amountUnits <= 0n) throw new Error('Grant policy amount must be positive');
    if (input.type === 'promotion') {
      if (!Number.isSafeInteger(input.expiresInMs) || input.expiresInMs <= 0) {
        throw new Error('Promotion expiresInMs must be a positive integer');
      }
    } else if (!['day', 'week', 'month'].includes(input.cadence)) {
      throw new Error('Allowance cadence must be day, week, or month');
    }
    const request = { ...input, amountUnits: amountUnits.toString() };
    return store.transaction((tx) =>
      this.idempotent(tx, 'create_grant_policy', input.idempotencyKey, request, async () => {
        const key = requireText(input.key, 'key');
        const policies = (await tx.listGrantPolicies(this.projectId)).filter(
          (policy) => policy.key === key,
        );
        const version = Math.max(0, ...policies.map((policy) => policy.version)) + 1;
        const base = {
          id: createId('gpol'),
          projectId: this.projectId,
          key,
          version,
          type: input.type,
          amount: creditUnitsToString(amountUnits),
          amountUnits: amountUnits.toString(),
          createdAt: this.now(),
          metadata: input.metadata,
        };
        const policy: CreditGrantPolicy =
          input.type === 'allowance'
            ? ({
                ...base,
                type: 'allowance',
                cadence: input.cadence,
              } satisfies AllowanceGrantPolicy)
            : ({
                ...base,
                type: 'promotion',
                expiresInMs: input.expiresInMs,
              } satisfies PromotionGrantPolicy);
        await tx.saveGrantPolicy(policy);
        await this.saveOutboxEvent(tx, 'credit.policy.created', { policy }, policy.createdAt);
        return policy;
      }),
    );
  }

  async applyAllowance(input: ApplyAllowanceInput): Promise<GrantPolicyResult> {
    const store = this.requirePolicyStore();
    return store.transaction((tx) =>
      this.idempotent(tx, 'apply_allowance', input.idempotencyKey, input, async () => {
        const now = this.now();
        const policy = await this.requireGrantPolicy(tx, input.policyId, 'allowance');
        await this.expireDueCreditLots(tx, now, input.customerId);
        const current = await this.ensureAccountInTransaction(tx, input.customerId, input.metadata);
        const periodKey = allowancePeriodKey(now, policy.cadence);
        const existing = await tx.getGrantPolicyApplicationByIdentity(
          policy.id,
          current.id,
          periodKey,
        );
        if (existing) {
          const account = await this.requireAccountById(tx, current.id);
          return {
            policy,
            application: existing,
            account,
            grant: existing.grantId ? await tx.getGrant(existing.grantId) : undefined,
          };
        }
        const lots = await tx.listCreditLots({
          projectId: this.projectId,
          customerId: current.customerId,
          policyId: policy.id,
          kind: 'allowance',
        });
        const unspentUnits = lots.reduce(
          (total, lot) =>
            total + parseCreditUnits(lot.availableUnits) + parseCreditUnits(lot.reservedUnits),
          0n,
        );
        const targetUnits = parseCreditUnits(policy.amountUnits);
        const topUpUnits = targetUnits > unspentUnits ? targetUnits - unspentUnits : 0n;
        let account = current;
        let grant: CreditGrant | undefined;
        if (topUpUnits > 0n) {
          const created = await this.createGrantInTransaction(tx, {
            customerId: current.customerId,
            amountUnits: topUpUnits,
            source: 'allowance',
            policyId: policy.id,
            lotKind: 'allowance',
            now,
            metadata: input.metadata,
          });
          account = created.account;
          grant = created.grant;
        }
        const application: GrantPolicyApplication = {
          id: createId('gpa'),
          policyId: policy.id,
          policyType: 'allowance',
          accountId: account.id,
          projectId: this.projectId,
          customerId: account.customerId,
          periodKey,
          grantId: grant?.id,
          grantedAmount: creditUnitsToString(topUpUnits),
          grantedUnits: topUpUnits.toString(),
          createdAt: now,
          metadata: input.metadata,
        };
        await tx.saveGrantPolicyApplication(application);
        await this.saveOutboxEvent(
          tx,
          'credit.allowance.applied',
          { policy, application, account, grant },
          now,
        );
        return { policy, application, account, grant };
      }),
    );
  }

  async claimPromotion(input: ClaimPromotionInput): Promise<GrantPolicyResult> {
    const store = this.requirePolicyStore();
    return store.transaction((tx) =>
      this.idempotent(tx, 'claim_promotion', input.idempotencyKey, input, async () => {
        const now = this.now();
        const policy = await this.requireGrantPolicy(tx, input.policyId, 'promotion');
        await this.expireDueCreditLots(tx, now, input.customerId);
        const current = await this.ensureAccountInTransaction(tx, input.customerId, input.metadata);
        const periodKey = 'claim';
        const existing = await tx.getGrantPolicyApplicationByIdentity(
          policy.id,
          current.id,
          periodKey,
        );
        if (existing) {
          const account = await this.requireAccountById(tx, current.id);
          return {
            policy,
            application: existing,
            account,
            grant: existing.grantId ? await tx.getGrant(existing.grantId) : undefined,
          };
        }
        const expiresAt = now + policy.expiresInMs;
        if (!Number.isSafeInteger(expiresAt)) {
          throw new Error('Promotion expiry exceeds the supported timestamp range');
        }
        const created = await this.createGrantInTransaction(tx, {
          customerId: current.customerId,
          amountUnits: parseCreditUnits(policy.amountUnits),
          source: 'promotion',
          policyId: policy.id,
          expiresAt,
          lotKind: 'promotion',
          now,
          metadata: input.metadata,
        });
        const application: GrantPolicyApplication = {
          id: createId('gpa'),
          policyId: policy.id,
          policyType: 'promotion',
          accountId: created.account.id,
          projectId: this.projectId,
          customerId: created.account.customerId,
          periodKey,
          grantId: created.grant.id,
          grantedAmount: created.grant.amount,
          grantedUnits: created.grant.amountUnits,
          createdAt: now,
          metadata: input.metadata,
        };
        await tx.saveGrantPolicyApplication(application);
        await this.saveOutboxEvent(
          tx,
          'credit.promotion.claimed',
          { policy, application, account: created.account, grant: created.grant },
          now,
        );
        return { policy, application, account: created.account, grant: created.grant };
      }),
    );
  }

  async sweepExpiredCreditLots(
    input: SweepExpiredCreditLotsInput = {},
  ): Promise<SweepExpiredCreditLotsResult> {
    const store = this.requirePolicyStore();
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('Credit lot sweep limit must be a positive integer');
    }
    const before = input.before ?? this.now();
    if (!Number.isSafeInteger(before))
      throw new Error('Credit lot sweep before must be an integer');
    return store.transaction((tx) => this.expireDueCreditLots(tx, before, input.customerId, limit));
  }

  async grantCredits(
    input: GrantCreditsInput,
  ): Promise<{ account: CreditAccount; grant: CreditGrant }> {
    const amountUnits = toCreditUnits(input.amount);
    if (amountUnits <= 0n) throw new Error('Credit grant amount must be positive');
    const request = { ...input, amountUnits: amountUnits.toString() };

    return this.withStoreTransaction((tx) =>
      this.idempotent(tx, 'grant_credits', input.idempotencyKey, request, () =>
        this.createGrantInTransaction(tx, {
          customerId: input.customerId,
          amountUnits,
          source: input.source ?? 'manual',
          externalRef: input.externalRef,
          lotKind: 'general',
          now: this.now(),
          metadata: input.metadata,
        }),
      ),
    );
  }

  async adjustCredits(
    input: AdjustCreditsInput,
  ): Promise<{ account: CreditAccount; entry: LedgerEntry }> {
    const deltaUnits = toSignedCreditUnits(input.amount);
    if (deltaUnits === 0n) throw new Error('Credit adjustment amount cannot be zero');
    const request = { ...input, deltaUnits: deltaUnits.toString() };

    return this.withStoreTransaction((tx) =>
      this.idempotent(tx, 'adjust_credits', input.idempotencyKey, request, async () => {
        const now = this.now();
        if (isPolicyTransaction(tx)) await this.expireDueCreditLots(tx, now, input.customerId);
        const current = await this.ensureAccountInTransaction(tx, input.customerId, input.metadata);
        const nextPosted = parseCreditUnits(current.postedUnits) + deltaUnits;
        const reserved = parseCreditUnits(current.reservedUnits);
        if (nextPosted < reserved) {
          throw new InsufficientCreditsError((nextPosted - reserved).toString(), '0');
        }
        if (isPolicyTransaction(tx)) {
          if (deltaUnits > 0n) {
            await tx.saveCreditLot(
              createCreditLot({
                account: current,
                kind: 'general',
                amountUnits: deltaUnits,
                now,
                metadata: { ...input.metadata, reason: input.reason },
              }),
            );
          } else {
            await this.consumeAvailableLots(tx, current, -deltaUnits, now);
          }
        }
        const account = withBalances(current, nextPosted, reserved, now);
        await tx.saveAccount(account);
        const entry = await this.saveLedgerEntry(
          tx,
          account,
          'adjustment',
          'posted',
          deltaUnits,
          'adjustment',
          createId('adj'),
          now,
          {
            ...input.metadata,
            reason: requireText(input.reason, 'reason'),
          },
        );
        await this.saveOutboxEvent(tx, 'credit.adjusted', { account, entry }, now);
        return { account, entry };
      }),
    );
  }

  async registerMeter(input: RegisterMeterInput): Promise<MeterDefinition> {
    return this.store.transaction((tx) =>
      this.idempotent(tx, 'register_meter', input.idempotencyKey, input, async () => {
        const existing = await tx.getMeterByKey(this.projectId, input.key);
        if (existing) {
          if (
            stableStringify(existing.dimensions) !== stableStringify([...new Set(input.dimensions)])
          ) {
            throw new InvalidCreditStateError(`Meter is immutable after creation: ${input.key}`);
          }
          return existing;
        }
        const meter = createMeterDefinition({
          id: createId('meter'),
          projectId: this.projectId,
          key: input.key,
          name: input.name,
          dimensions: input.dimensions,
          createdAt: this.now(),
          metadata: input.metadata,
        });
        await tx.saveMeter(meter);
        return meter;
      }),
    );
  }

  async createPriceVersion(input: CreatePriceVersionInput): Promise<PriceVersion>;
  async createPriceVersion(input: CreateAdvancedPriceVersionInput): Promise<PriceVersion>;
  async createPriceVersion(
    input: CreatePriceVersionInput | CreateAdvancedPriceVersionInput,
  ): Promise<PriceVersion> {
    return this.store.transaction((tx) =>
      this.idempotent(tx, 'create_price_version', input.idempotencyKey, input, async () => {
        const meter = await tx.getMeterByKey(this.projectId, input.meterKey);
        if (!meter) throw new CreditNotFoundError('Meter', input.meterKey);
        const versions = await tx.listPriceVersions(meter.id);
        const base = {
          id: createId('price'),
          projectId: this.projectId,
          meter,
          version: versions.reduce((max, item) => Math.max(max, item.version), 0) + 1,
          createdAt: this.now(),
          metadata: input.metadata,
        };
        const price =
          'components' in input
            ? createPriceVersion({
                ...base,
                rates: input.rates,
                components: input.components,
              })
            : createPriceVersion({ ...base, rates: input.rates });
        await tx.savePriceVersion(price);
        return price;
      }),
    );
  }

  async createFundingIntent(input: CreateFundingIntentInput): Promise<FundingIntent> {
    const requestedUnits = toCreditUnits(input.amount);
    if (requestedUnits <= 0n) throw new Error('Funding amount must be positive');
    return this.store.transaction((tx) =>
      this.idempotent(tx, 'create_funding_intent', input.idempotencyKey, input, async () => {
        const now = this.now();
        const account = await this.ensureAccountInTransaction(tx, input.customerId, input.metadata);
        const intentId = input.id ?? createId('fund');
        const existing = await tx.getFundingIntent(intentId);
        if (existing) {
          throw new InvalidCreditStateError(`Funding intent id already exists: ${intentId}`);
        }
        const intent: FundingIntent = {
          id: intentId,
          projectId: this.projectId,
          customerId: account.customerId,
          accountId: account.id,
          status: 'pending',
          requestedAmount: creditUnitsToString(requestedUnits),
          requestedUnits: requestedUnits.toString(),
          rail: input.rail ?? 'arc_direct',
          network: requireText(input.network, 'network'),
          invoiceId: requireText(input.invoiceId, 'invoiceId'),
          createdAt: now,
          expiresAt: input.expiresAt,
          metadata: input.metadata,
        };
        await tx.saveFundingIntent(intent);
        await this.saveOutboxEvent(tx, 'funding.intent.created', { fundingIntent: intent }, now);
        return intent;
      }),
    );
  }

  async confirmFunding(input: ConfirmFundingInput): Promise<{
    account: CreditAccount;
    grant: CreditGrant;
    fundingIntent: FundingIntent;
    fundingTransaction: FundingTransaction;
  }> {
    const amountUnits = toCreditUnits(input.amount);
    const rail = input.rail ?? 'arc_direct';
    const externalPaymentId = requireText(
      input.externalPaymentId ?? input.txHash ?? '',
      'externalPaymentId',
    );

    return this.withStoreTransaction(async (tx) => {
      const intent = await tx.getFundingIntent(input.fundingIntentId);
      if (!intent || intent.projectId !== this.projectId)
        throw new CreditNotFoundError('Funding intent', input.fundingIntentId);
      if (intent.network !== input.network)
        throw new InvalidCreditStateError('Funding network does not match the intent');
      if (intent.rail !== rail)
        throw new InvalidCreditStateError('Funding rail does not match the intent');
      if (intent.expiresAt !== undefined && intent.expiresAt <= this.now())
        throw new InvalidCreditStateError(`Funding intent is expired: ${intent.id}`);

      const existingByExternalPayment = await tx.getFundingTransactionByExternalPayment(
        rail,
        input.network,
        externalPaymentId,
      );
      const existingByTransactionHash = input.txHash
        ? await tx.getFundingTransactionByTxHash(input.network, input.txHash)
        : undefined;
      if (
        existingByExternalPayment &&
        existingByTransactionHash &&
        existingByExternalPayment.id !== existingByTransactionHash.id
      ) {
        throw new InvalidCreditStateError(
          `Funding identifiers refer to different payments: ${externalPaymentId}`,
        );
      }
      const existing = existingByExternalPayment ?? existingByTransactionHash;
      if (existing) {
        if (existing.fundingIntentId !== intent.id) {
          throw new InvalidCreditStateError(
            `Funding payment is already assigned: ${input.txHash ?? externalPaymentId}`,
          );
        }
        const account = await this.requireAccountById(tx, intent.accountId);
        const grant = await tx.getGrant(existing.grantId);
        if (!grant) throw new CreditNotFoundError('Credit grant', existing.grantId);
        return { account, grant, fundingIntent: intent, fundingTransaction: existing };
      }

      return this.idempotent(tx, 'confirm_funding', input.idempotencyKey, input, async () => {
        if (intent.status !== 'pending')
          throw new InvalidCreditStateError(`Funding intent is ${intent.status}: ${intent.id}`);
        const requestedUnits = parseCreditUnits(intent.requestedUnits);
        if (
          input.requireExactAmount ? amountUnits !== requestedUnits : amountUnits < requestedUnits
        ) {
          throw new InvalidCreditStateError(
            input.requireExactAmount
              ? `Funding amount mismatch: ${amountUnits} !== ${intent.requestedUnits}`
              : `Funding underpayment: ${amountUnits} < ${intent.requestedUnits}`,
          );
        }

        const now = this.now();
        if (isPolicyTransaction(tx)) await this.expireDueCreditLots(tx, now, intent.customerId);
        const current = await this.requireAccountById(tx, intent.accountId);
        const grant: CreditGrant = {
          id: createId('grant'),
          accountId: current.id,
          projectId: this.projectId,
          customerId: current.customerId,
          amount: creditUnitsToString(amountUnits),
          amountUnits: amountUnits.toString(),
          source: rail === 'arc_direct' ? 'arc' : 'circle_gateway_nanopayment',
          externalRef: `${rail}:${input.network}:${externalPaymentId.toLowerCase()}`,
          createdAt: now,
          metadata: {
            ...input.metadata,
            fundingIntentId: intent.id,
            paymentReceiptId: input.paymentReceiptId,
          },
        };
        const account = withBalances(
          current,
          parseCreditUnits(current.postedUnits) + amountUnits,
          parseCreditUnits(current.reservedUnits),
          now,
        );
        const confirmedIntent: FundingIntent = { ...intent, status: 'confirmed', confirmedAt: now };
        const settlementStatus = input.settlementStatus ?? 'settled';
        const settledAt =
          settlementStatus === 'settled' ? Math.max(input.settledAt ?? now, now) : undefined;
        const fundingTransaction: FundingTransaction = {
          id: createId('ftx'),
          fundingIntentId: intent.id,
          projectId: this.projectId,
          customerId: account.customerId,
          accountId: account.id,
          rail,
          network: input.network,
          externalPaymentId,
          txHash: input.txHash,
          amount: grant.amount,
          amountUnits: grant.amountUnits,
          paymentReceiptId: input.paymentReceiptId,
          grantId: grant.id,
          payer: input.payer ?? input.evidence?.payer,
          settlementStatus,
          acceptedAt: now,
          settledAt,
          evidence: {
            ...input.evidence,
            amountUnits: amountUnits.toString(),
            payer: input.payer ?? input.evidence?.payer,
          },
          createdAt: now,
          metadata: input.metadata,
        };
        await tx.saveGrant(grant);
        if (isPolicyTransaction(tx)) {
          await tx.saveCreditLot(
            createCreditLot({
              account: current,
              kind: 'general',
              amountUnits,
              grantId: grant.id,
              now,
              metadata: grant.metadata,
            }),
          );
        }
        await tx.saveAccount(account);
        await tx.saveFundingIntent(confirmedIntent);
        await tx.saveFundingTransaction(fundingTransaction);
        await this.saveLedgerEntry(
          tx,
          account,
          'grant',
          'posted',
          amountUnits,
          'funding',
          fundingTransaction.id,
          now,
          grant.metadata,
        );
        await this.saveOutboxEvent(
          tx,
          'funding.accepted',
          { fundingIntent: confirmedIntent, fundingTransaction },
          now,
        );
        await this.saveOutboxEvent(
          tx,
          'funding.confirmed',
          { fundingIntent: confirmedIntent, fundingTransaction, account, grant },
          now,
        );
        if (settlementStatus === 'settled') {
          await this.saveOutboxEvent(
            tx,
            'funding.settled',
            { fundingIntent: confirmedIntent, fundingTransaction },
            fundingTransaction.settledAt!,
          );
        }
        return { account, grant, fundingIntent: confirmedIntent, fundingTransaction };
      });
    });
  }

  async updateFundingSettlement(input: UpdateFundingSettlementInput): Promise<FundingTransaction> {
    return this.store.transaction((tx) =>
      this.idempotent(tx, 'update_funding_settlement', input.idempotencyKey, input, async () => {
        const transaction = await tx.getFundingTransaction(input.fundingTransactionId);
        if (!transaction || transaction.projectId !== this.projectId) {
          throw new CreditNotFoundError('Funding transaction', input.fundingTransactionId);
        }
        if (transaction.settlementStatus === input.status) return transaction;
        if (
          transaction.settlementStatus === 'settled' &&
          input.status !== 'reconciliation_required'
        ) {
          throw new InvalidCreditStateError(
            `Funding transaction is already settled: ${transaction.id}`,
          );
        }
        const now = this.now();
        const updated: FundingTransaction = {
          ...transaction,
          settlementStatus: input.status,
          settledAt: input.status === 'settled' ? (input.settledAt ?? now) : transaction.settledAt,
          metadata: {
            ...transaction.metadata,
            ...input.metadata,
            reconciliationReason: input.reason,
          },
        };
        await tx.saveFundingTransaction(updated);
        await this.saveOutboxEvent(
          tx,
          input.status === 'settled' ? 'funding.settled' : 'funding.reconciliation_required',
          { fundingTransaction: updated, reason: input.reason },
          now,
        );
        return updated;
      }),
    );
  }

  async failFundingIntent(input: FailFundingIntentInput): Promise<FundingIntent> {
    return this.store.transaction((tx) =>
      this.idempotent(tx, 'fail_funding', input.idempotencyKey, input, async () => {
        const intent = await tx.getFundingIntent(input.fundingIntentId);
        if (!intent || intent.projectId !== this.projectId)
          throw new CreditNotFoundError('Funding intent', input.fundingIntentId);
        if (intent.status === 'failed') return intent;
        if (intent.status !== 'pending')
          throw new InvalidCreditStateError(`Funding intent is ${intent.status}: ${intent.id}`);
        const failed: FundingIntent = {
          ...intent,
          status: 'failed',
          failedAt: this.now(),
          failureReason: requireText(input.reason, 'reason'),
        };
        await tx.saveFundingIntent(failed);
        await this.saveOutboxEvent(
          tx,
          'funding.failed',
          { fundingIntent: failed },
          failed.failedAt!,
        );
        return failed;
      }),
    );
  }

  async reserveCredits(input: ReserveCreditsInput): Promise<CreditReservation> {
    return this.withStoreTransaction((tx) =>
      this.idempotent(tx, 'reserve_credits', input.idempotencyKey, input, async () => {
        const now = this.now();
        await this.expireOpenReservations(tx, now, input.customerId);
        if (isPolicyTransaction(tx)) await this.expireDueCreditLots(tx, now, input.customerId);
        const price = await this.requirePrice(tx, input.priceId);
        const rating = rateUsage(price, input.estimatedUsage);
        const reservedUnits = parseCreditUnits(rating.totalUnits);
        const current = await this.ensureAccountInTransaction(tx, input.customerId, input.metadata);
        const available = parseCreditUnits(current.availableUnits);
        if (available < reservedUnits) {
          throw new InsufficientCreditsError(available.toString(), reservedUnits.toString());
        }
        const expiresAt = input.expiresAt ?? now + this.reservationTtlMs;
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
          throw new Error('Reservation expiresAt must be in the future');
        }
        const reservation: CreditReservation = {
          id: createId('rsv'),
          accountId: current.id,
          projectId: this.projectId,
          customerId: current.customerId,
          priceId: price.id,
          status: 'open',
          estimatedUsage: normalizeUsage(input.estimatedUsage),
          reservedAmount: rating.totalAmount,
          reservedUnits: rating.totalUnits,
          createdAt: now,
          expiresAt,
          metadata: input.metadata,
        };
        const account = withBalances(
          current,
          parseCreditUnits(current.postedUnits),
          parseCreditUnits(current.reservedUnits) + reservedUnits,
          now,
        );
        await tx.saveReservation(reservation);
        if (isPolicyTransaction(tx)) {
          await this.reserveCreditLots(tx, current, reservation.id, reservedUnits, now);
        }
        await tx.saveAccount(account);
        await this.saveLedgerEntry(
          tx,
          account,
          'reserve',
          'reserved',
          reservedUnits,
          'reservation',
          reservation.id,
          now,
          input.metadata,
        );
        await this.saveOutboxEvent(tx, 'credit.reserved', { account, reservation }, now);
        return reservation;
      }),
    );
  }

  async commitUsage(
    input: CommitUsageInput,
  ): Promise<{ receipt: UsageReceipt; reservation: CreditReservation; balance: CreditAccount }> {
    return this.withStoreTransaction((tx) =>
      this.idempotent(tx, 'commit_usage', input.idempotencyKey, input, async () => {
        const now = this.now();
        const reservation = await this.requireReservation(tx, input.reservationId);
        if (reservation.status === 'committed' && reservation.usageReceiptId) {
          const receipt = await tx.getUsageReceipt(reservation.usageReceiptId);
          const balance = await tx.getAccount(reservation.accountId);
          if (receipt && balance) return { receipt, reservation, balance };
        }
        if (reservation.status !== 'open') {
          throw new InvalidCreditStateError(
            `Reservation is ${reservation.status}: ${reservation.id}`,
          );
        }
        if (reservation.expiresAt <= now) {
          await this.expireReservation(tx, reservation, now);
          throw new InvalidCreditStateError(`Reservation expired: ${reservation.id}`);
        }

        const existingUsage = await tx.getUsageEvent(input.usageEventId);
        if (existingUsage) {
          throw new InvalidCreditStateError(`Usage event already exists: ${input.usageEventId}`);
        }
        const price = await this.requirePrice(tx, reservation.priceId);
        const rating = rateUsage(price, input.actualUsage);
        const chargeUnits = parseCreditUnits(rating.totalUnits);
        const reservedUnits = parseCreditUnits(reservation.reservedUnits);
        if (chargeUnits > reservedUnits) {
          throw new InvalidCreditStateError(
            `Actual charge exceeds reservation: ${rating.totalUnits} > ${reservation.reservedUnits}`,
          );
        }

        if (isPolicyTransaction(tx)) {
          await this.expireDueCreditLots(tx, now, reservation.customerId);
        }
        const accountBefore = await this.requireAccountById(tx, reservation.accountId);
        const postedBefore = parseCreditUnits(accountBefore.postedUnits);
        const reservedBefore = parseCreditUnits(accountBefore.reservedUnits);
        const lotResult = isPolicyTransaction(tx)
          ? await this.commitCreditLotAllocations(tx, reservation, chargeUnits, now)
          : { allocations: undefined, expiredReleasedUnits: 0n, expiredLots: [] };
        const account = withBalances(
          accountBefore,
          postedBefore - chargeUnits - lotResult.expiredReleasedUnits,
          reservedBefore - reservedUnits,
          now,
        );
        const releasedUnits = reservedUnits - chargeUnits;
        const usageEvent: UsageEvent = {
          id: requireText(input.usageEventId, 'usageEventId'),
          accountId: account.id,
          projectId: this.projectId,
          customerId: account.customerId,
          reservationId: reservation.id,
          priceId: price.id,
          quantities: normalizeUsage(input.actualUsage),
          occurredAt: input.occurredAt ?? now,
          receivedAt: now,
          metadata: input.metadata,
        };
        const receipt: UsageReceipt = {
          id: createId('urcpt'),
          accountId: account.id,
          projectId: this.projectId,
          customerId: account.customerId,
          reservationId: reservation.id,
          usageEventId: usageEvent.id,
          priceId: price.id,
          currency: 'USD',
          amount: rating.totalAmount,
          amountUnits: rating.totalUnits,
          releasedAmount: creditUnitsToString(releasedUnits),
          releasedUnits: releasedUnits.toString(),
          lineItems: rating.lineItems,
          balanceBeforeUnits: accountBefore.availableUnits,
          balanceAfterUnits: account.availableUnits,
          createdAt: now,
          allocations: lotResult.allocations,
          metadata: input.metadata,
        };
        const committedReservation: CreditReservation = {
          ...reservation,
          status: 'committed',
          committedAmount: rating.totalAmount,
          committedUnits: rating.totalUnits,
          releasedAmount: receipt.releasedAmount,
          releasedUnits: receipt.releasedUnits,
          usageReceiptId: receipt.id,
          closedAt: now,
        };

        await tx.saveUsageEvent(usageEvent);
        await tx.saveUsageReceipt(receipt);
        await tx.saveReservation(committedReservation);
        await tx.saveAccount(account);
        await this.saveLedgerEntry(
          tx,
          account,
          'charge',
          'posted',
          -chargeUnits,
          'usage_receipt',
          receipt.id,
          now,
          input.metadata,
        );
        await this.saveLedgerEntry(
          tx,
          account,
          'release',
          'reserved',
          -reservedUnits,
          'usage_receipt',
          receipt.id,
          now,
          input.metadata,
        );
        for (const expired of lotResult.expiredLots) {
          await this.saveLedgerEntry(
            tx,
            account,
            'expire',
            'posted',
            -expired.units,
            'credit_lot',
            expired.lot.id,
            now,
            { reason: 'released_after_expiry', reservationId: reservation.id },
          );
          await this.saveOutboxEvent(
            tx,
            'credit.lot.expired',
            { account, lot: expired.lot, expiredUnits: expired.units.toString() },
            now,
          );
        }
        await this.saveOutboxEvent(
          tx,
          'usage.charged',
          {
            usageReceiptId: receipt.id,
            accountId: account.id,
            customerId: account.customerId,
            reservationId: reservation.id,
            amount: receipt.amount,
            amountUnits: receipt.amountUnits,
            releasedAmount: receipt.releasedAmount,
            balanceAfterUnits: receipt.balanceAfterUnits,
            allocations: receipt.allocations,
          },
          now,
        );
        return { receipt, reservation: committedReservation, balance: account };
      }),
    );
  }

  async releaseReservation(
    input: ReleaseReservationInput,
  ): Promise<{ reservation: CreditReservation; balance: CreditAccount }> {
    return this.withStoreTransaction((tx) =>
      this.idempotent(tx, 'release_reservation', input.idempotencyKey, input, async () => {
        const reservation = await this.requireReservation(tx, input.reservationId);
        if (reservation.status === 'released' || reservation.status === 'expired') {
          return { reservation, balance: await this.requireAccountById(tx, reservation.accountId) };
        }
        if (reservation.status !== 'open') {
          throw new InvalidCreditStateError(
            `Cannot release ${reservation.status} reservation: ${reservation.id}`,
          );
        }
        return this.closeReservation(tx, reservation, 'released', this.now(), input.reason);
      }),
    );
  }

  async releaseExpiredReservations(input: {
    idempotencyKey: string;
    now?: number;
  }): Promise<CreditReservation[]> {
    return this.withStoreTransaction((tx) =>
      this.idempotent(tx, 'release_expired', input.idempotencyKey, input, async () =>
        this.expireOpenReservations(tx, input.now ?? this.now()),
      ),
    );
  }

  async runMetered<T>(
    input: RunMeteredInput,
    callback: () => Promise<RunMeteredCallbackResult<T>>,
  ): Promise<RunMeteredResult<T>> {
    const reserved = await this.reserveCredits(input);
    const reservation = (await this.store.getReservation(reserved.id)) ?? reserved;
    if (reservation.status === 'committed' && reservation.usageReceiptId) {
      const receipt = await this.requireUsageReceipt(reservation.usageReceiptId);
      return {
        replayed: true,
        reservation,
        receipt,
        balance: await this.getBalance(reservation.customerId),
      };
    }

    let result: RunMeteredCallbackResult<T>;
    try {
      result = await callback();
    } catch (error) {
      await this.releaseReservation({
        reservationId: reservation.id,
        idempotencyKey: `${input.idempotencyKey}:provider_error`,
        reason: 'provider_error',
      });
      throw error;
    }

    const committed = await this.commitUsage({
      reservationId: reservation.id,
      usageEventId: result.usageEventId,
      actualUsage: result.actualUsage,
      occurredAt: result.occurredAt,
      metadata: result.metadata,
      idempotencyKey: `${input.idempotencyKey}:commit`,
    });
    return { value: result.value, replayed: false, ...committed };
  }

  async getBalance(customerId: string): Promise<CreditAccount> {
    if (isCreditPolicyStore(this.store)) {
      return this.store.transaction(async (tx) => {
        const normalized = requireText(customerId, 'customerId');
        await this.expireDueCreditLots(tx, this.now(), normalized);
        const account = await tx.getAccountByCustomer(this.projectId, normalized);
        if (!account) throw new CreditNotFoundError('Credit account', customerId);
        return account;
      });
    }
    const account = await this.store.getAccountByCustomer(
      this.projectId,
      requireText(customerId, 'customerId'),
    );
    if (!account) throw new CreditNotFoundError('Credit account', customerId);
    return account;
  }

  async getGrantPolicy(id: string): Promise<CreditGrantPolicy | undefined> {
    return this.forCurrentProject(await this.requirePolicyStore().getGrantPolicy(id));
  }

  listGrantPolicies(): Promise<CreditGrantPolicy[]> {
    return this.requirePolicyStore().listGrantPolicies(this.projectId);
  }

  async getCreditLot(id: string): Promise<CreditLot | undefined> {
    const store = this.requirePolicyStore();
    const value = this.forCurrentProject(await store.getCreditLot(id));
    if (!value) return undefined;
    await this.getBalance(value.customerId);
    return this.forCurrentProject(await store.getCreditLot(id));
  }

  async listCreditLots(
    filter: string | Omit<CreditLotFilter, 'projectId'> = {},
  ): Promise<CreditLot[]> {
    const store = this.requirePolicyStore();
    const normalized = typeof filter === 'string' ? { customerId: filter } : filter;
    if (normalized.customerId) await this.getBalance(normalized.customerId);
    else {
      await store.transaction((tx) =>
        this.expireDueCreditLots(tx, this.now(), undefined, Number.MAX_SAFE_INTEGER),
      );
    }
    return store.listCreditLots({ ...normalized, projectId: this.projectId });
  }

  async listGrantPolicyApplications(
    filter: string | Omit<GrantPolicyApplicationFilter, 'projectId'> = {},
  ): Promise<GrantPolicyApplication[]> {
    const store = this.requirePolicyStore();
    const normalized = typeof filter === 'string' ? { customerId: filter } : filter;
    if (normalized.customerId) await this.getBalance(normalized.customerId);
    return store.listGrantPolicyApplications({ ...normalized, projectId: this.projectId });
  }

  async getGrantPolicyApplication(id: string): Promise<GrantPolicyApplication | undefined> {
    return this.forCurrentProject(await this.requirePolicyStore().getGrantPolicyApplication(id));
  }

  async listCreditLotAllocations(reservationId?: string): Promise<CreditLotAllocation[]> {
    const allocations = await this.requirePolicyStore().listCreditLotAllocations(reservationId);
    return this.forCurrentProjectList(allocations);
  }

  async getReservation(id: string) {
    return this.forCurrentProject(await this.store.getReservation(id));
  }
  async getUsageReceipt(id: string) {
    return this.forCurrentProject(await this.store.getUsageReceipt(id));
  }
  async getFundingIntent(id: string) {
    return this.forCurrentProject(await this.store.getFundingIntent(id));
  }
  listFundingIntents() {
    return this.store.listFundingIntents(this.projectId);
  }
  async getFundingTransaction(id: string) {
    return this.forCurrentProject(await this.store.getFundingTransaction(id));
  }
  async listFundingTransactions(fundingIntentId?: string) {
    return this.forCurrentProjectList(await this.store.listFundingTransactions(fundingIntentId));
  }
  async listUsageReceipts(customerId?: string) {
    const values = customerId
      ? this.getBalance(customerId).then((account) => this.store.listUsageReceipts(account.id))
      : this.store.listUsageReceipts();
    return this.forCurrentProjectList(await values);
  }
  async listLedgerEntries(customerId?: string) {
    const values = customerId
      ? this.getBalance(customerId).then((account) => this.store.listLedgerEntries(account.id))
      : this.store.listLedgerEntries();
    return this.forCurrentProjectList(await values);
  }
  listOutboxEvents(filter: Omit<OutboxEventFilter, 'projectId'> = {}) {
    return this.store.listOutboxEvents({ ...filter, projectId: this.projectId });
  }

  async markOutboxEventDelivered(input: {
    eventId: string;
    idempotencyKey: string;
    deliveredAt?: number;
  }): Promise<CreditOutboxEvent> {
    return this.store.transaction((tx) =>
      this.idempotent(tx, 'deliver_outbox', input.idempotencyKey, input, async () => {
        const event = await tx.getOutboxEvent(input.eventId);
        if (!event || event.projectId !== this.projectId)
          throw new CreditNotFoundError('Outbox event', input.eventId);
        if (event.status === 'delivered') return event;
        const delivered = {
          ...event,
          status: 'delivered' as const,
          deliveredAt: input.deliveredAt ?? this.now(),
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
        };
        await tx.saveOutboxEvent(delivered);
        return delivered;
      }),
    );
  }

  private withStoreTransaction<T>(
    handler: (transaction: CreditStoreTransaction | CreditPolicyStoreTransaction) => Promise<T>,
  ): Promise<T> {
    if (isCreditPolicyStore(this.store)) return this.store.transaction(handler);
    return this.store.transaction(handler);
  }

  private requirePolicyStore(): CreditPolicyStore {
    if (!isCreditPolicyStore(this.store)) throw new UnsupportedCreditStoreCapabilityError();
    return this.store;
  }

  private async requireGrantPolicy<TType extends CreditGrantPolicy['type']>(
    tx: CreditPolicyStoreTransaction,
    id: string,
    type: TType,
  ): Promise<Extract<CreditGrantPolicy, { type: TType }>> {
    const policy = await tx.getGrantPolicy(id);
    if (!policy || policy.projectId !== this.projectId) {
      throw new CreditNotFoundError('Grant policy', id);
    }
    if (policy.type !== type) {
      throw new InvalidCreditStateError(`Grant policy ${policy.id} is ${policy.type}, not ${type}`);
    }
    return policy as Extract<CreditGrantPolicy, { type: TType }>;
  }

  private async createGrantInTransaction(
    tx: CreditStoreTransaction | CreditPolicyStoreTransaction,
    input: {
      customerId: string;
      amountUnits: bigint;
      source: CreditGrantSource;
      externalRef?: string;
      policyId?: string;
      expiresAt?: number;
      lotKind: CreditLotKind;
      now: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ account: CreditAccount; grant: CreditGrant }> {
    if (input.amountUnits <= 0n) throw new Error('Credit grant amount must be positive');
    if (isPolicyTransaction(tx)) {
      await this.expireDueCreditLots(tx, input.now, input.customerId);
    }
    const current = await this.ensureAccountInTransaction(tx, input.customerId, input.metadata);
    const grant: CreditGrant = {
      id: createId('grant'),
      accountId: current.id,
      projectId: this.projectId,
      customerId: current.customerId,
      amount: creditUnitsToString(input.amountUnits),
      amountUnits: input.amountUnits.toString(),
      source: input.source,
      externalRef: input.externalRef,
      policyId: input.policyId,
      expiresAt: input.expiresAt,
      createdAt: input.now,
      metadata: input.metadata,
    };
    const account = withBalances(
      current,
      parseCreditUnits(current.postedUnits) + input.amountUnits,
      parseCreditUnits(current.reservedUnits),
      input.now,
    );
    await tx.saveGrant(grant);
    if (isPolicyTransaction(tx)) {
      await tx.saveCreditLot(
        createCreditLot({
          account: current,
          kind: input.lotKind,
          amountUnits: input.amountUnits,
          grantId: grant.id,
          policyId: input.policyId,
          expiresAt: input.expiresAt,
          now: input.now,
          metadata: input.metadata,
        }),
      );
    }
    await tx.saveAccount(account);
    await this.saveLedgerEntry(
      tx,
      account,
      'grant',
      'posted',
      input.amountUnits,
      'grant',
      grant.id,
      input.now,
      input.metadata,
    );
    await this.saveOutboxEvent(tx, 'credit.granted', { account, grant }, input.now);
    return { account, grant };
  }

  private async expireDueCreditLots(
    tx: CreditPolicyStoreTransaction,
    before: number,
    customerId?: string,
    limit = Number.MAX_SAFE_INTEGER,
  ): Promise<SweepExpiredCreditLotsResult> {
    const due = (
      await tx.listCreditLots({
        projectId: this.projectId,
        customerId,
        expiresBefore: before,
      })
    )
      .filter((lot) => parseCreditUnits(lot.availableUnits) > 0n)
      .sort(compareCreditLots)
      .slice(0, limit);
    const accounts = new Map<string, CreditAccount>();
    const lots: CreditLot[] = [];
    for (const lot of due) {
      const availableUnits = parseCreditUnits(lot.availableUnits);
      if (availableUnits === 0n) continue;
      const accountBefore =
        accounts.get(lot.accountId) ?? (await this.requireAccountById(tx, lot.accountId));
      const account = withBalances(
        accountBefore,
        parseCreditUnits(accountBefore.postedUnits) - availableUnits,
        parseCreditUnits(accountBefore.reservedUnits),
        before,
      );
      const expired = withCreditLotBalances(
        lot,
        0n,
        parseCreditUnits(lot.reservedUnits),
        parseCreditUnits(lot.consumedUnits),
        parseCreditUnits(lot.expiredUnits) + availableUnits,
        before,
      );
      await tx.saveCreditLot(expired);
      await tx.saveAccount(account);
      await this.saveLedgerEntry(
        tx,
        account,
        'expire',
        'posted',
        -availableUnits,
        'credit_lot',
        lot.id,
        before,
        { reason: 'lot_expired' },
      );
      await this.saveOutboxEvent(
        tx,
        'credit.lot.expired',
        { account, lot: expired, expiredUnits: availableUnits.toString() },
        before,
      );
      accounts.set(account.id, account);
      lots.push(expired);
    }
    return { lots, accounts: [...accounts.values()] };
  }

  private async reserveCreditLots(
    tx: CreditPolicyStoreTransaction,
    account: CreditAccount,
    reservationId: string,
    amountUnits: bigint,
    now: number,
  ): Promise<CreditLotAllocation[]> {
    let remaining = amountUnits;
    const lots = (
      await tx.listCreditLots({
        projectId: this.projectId,
        customerId: account.customerId,
      })
    )
      .filter(
        (lot) =>
          lot.accountId === account.id &&
          parseCreditUnits(lot.availableUnits) > 0n &&
          (lot.expiresAt === undefined || lot.expiresAt > now),
      )
      .sort(compareCreditLots);
    const allocations: CreditLotAllocation[] = [];
    for (const lot of lots) {
      if (remaining === 0n) break;
      const available = parseCreditUnits(lot.availableUnits);
      const allocated = available < remaining ? available : remaining;
      const updatedLot = withCreditLotBalances(
        lot,
        available - allocated,
        parseCreditUnits(lot.reservedUnits) + allocated,
        parseCreditUnits(lot.consumedUnits),
        parseCreditUnits(lot.expiredUnits),
        now,
      );
      const allocation = createCreditLotAllocation({
        reservationId,
        lot,
        amountUnits: allocated,
        now,
      });
      await tx.saveCreditLot(updatedLot);
      await tx.saveCreditLotAllocation(allocation);
      allocations.push(allocation);
      remaining -= allocated;
    }
    if (remaining !== 0n) {
      throw new InvalidCreditStateError(
        `Credit lot balance is missing ${remaining.toString()} units for account ${account.id}`,
      );
    }
    return allocations;
  }

  private async commitCreditLotAllocations(
    tx: CreditPolicyStoreTransaction,
    reservation: CreditReservation,
    chargeUnits: bigint,
    now: number,
  ): Promise<{
    allocations: CreditLotAllocation[];
    expiredReleasedUnits: bigint;
    expiredLots: { lot: CreditLot; units: bigint }[];
  }> {
    const allocations = await tx.listCreditLotAllocations(reservation.id);
    const allocatedTotal = allocations.reduce(
      (total, allocation) => total + parseCreditUnits(allocation.reservedUnits),
      0n,
    );
    if (allocatedTotal !== parseCreditUnits(reservation.reservedUnits)) {
      throw new InvalidCreditStateError(
        `Reservation lot allocations are incomplete: ${reservation.id}`,
      );
    }
    let remainingCharge = chargeUnits;
    let expiredReleasedUnits = 0n;
    const updated: CreditLotAllocation[] = [];
    const expiredLots: { lot: CreditLot; units: bigint }[] = [];
    const allocationLots = await Promise.all(
      allocations.map(async (allocation) => {
        const lot = await tx.getCreditLot(allocation.lotId);
        if (!lot) throw new CreditNotFoundError('Credit lot', allocation.lotId);
        return { allocation, lot };
      }),
    );
    allocationLots.sort((left, right) => compareCreditLots(left.lot, right.lot));
    for (const { allocation, lot } of allocationLots) {
      const reserved = parseCreditUnits(allocation.reservedUnits);
      const consumed = reserved < remainingCharge ? reserved : remainingCharge;
      const remainder = reserved - consumed;
      const expired = lot.expiresAt !== undefined && lot.expiresAt <= now;
      const updatedLot = withCreditLotBalances(
        lot,
        parseCreditUnits(lot.availableUnits) + (expired ? 0n : remainder),
        parseCreditUnits(lot.reservedUnits) - reserved,
        parseCreditUnits(lot.consumedUnits) + consumed,
        parseCreditUnits(lot.expiredUnits) + (expired ? remainder : 0n),
        now,
      );
      const updatedAllocation = withCreditLotAllocationBalances(
        allocation,
        0n,
        parseCreditUnits(allocation.consumedUnits) + consumed,
        parseCreditUnits(allocation.releasedUnits) + (expired ? 0n : remainder),
        parseCreditUnits(allocation.expiredUnits) + (expired ? remainder : 0n),
        now,
      );
      await tx.saveCreditLot(updatedLot);
      await tx.saveCreditLotAllocation(updatedAllocation);
      updated.push(updatedAllocation);
      remainingCharge -= consumed;
      if (expired && remainder > 0n) {
        expiredReleasedUnits += remainder;
        expiredLots.push({ lot: updatedLot, units: remainder });
      }
    }
    if (remainingCharge !== 0n) {
      throw new InvalidCreditStateError(`Reservation cannot cover charge: ${reservation.id}`);
    }
    return { allocations: updated, expiredReleasedUnits, expiredLots };
  }

  private async releaseCreditLotAllocations(
    tx: CreditPolicyStoreTransaction,
    reservation: CreditReservation,
    now: number,
  ): Promise<{
    expiredReleasedUnits: bigint;
    expiredLots: { lot: CreditLot; units: bigint }[];
  }> {
    const allocations = await tx.listCreditLotAllocations(reservation.id);
    const allocatedTotal = allocations.reduce(
      (total, allocation) => total + parseCreditUnits(allocation.reservedUnits),
      0n,
    );
    if (allocatedTotal !== parseCreditUnits(reservation.reservedUnits)) {
      throw new InvalidCreditStateError(
        `Reservation lot allocations are incomplete: ${reservation.id}`,
      );
    }
    let expiredReleasedUnits = 0n;
    const expiredLots: { lot: CreditLot; units: bigint }[] = [];
    for (const allocation of allocations) {
      const lot = await tx.getCreditLot(allocation.lotId);
      if (!lot) throw new CreditNotFoundError('Credit lot', allocation.lotId);
      const reserved = parseCreditUnits(allocation.reservedUnits);
      const expired = lot.expiresAt !== undefined && lot.expiresAt <= now;
      const updatedLot = withCreditLotBalances(
        lot,
        parseCreditUnits(lot.availableUnits) + (expired ? 0n : reserved),
        parseCreditUnits(lot.reservedUnits) - reserved,
        parseCreditUnits(lot.consumedUnits),
        parseCreditUnits(lot.expiredUnits) + (expired ? reserved : 0n),
        now,
      );
      const updatedAllocation = withCreditLotAllocationBalances(
        allocation,
        0n,
        parseCreditUnits(allocation.consumedUnits),
        parseCreditUnits(allocation.releasedUnits) + (expired ? 0n : reserved),
        parseCreditUnits(allocation.expiredUnits) + (expired ? reserved : 0n),
        now,
      );
      await tx.saveCreditLot(updatedLot);
      await tx.saveCreditLotAllocation(updatedAllocation);
      if (expired && reserved > 0n) {
        expiredReleasedUnits += reserved;
        expiredLots.push({ lot: updatedLot, units: reserved });
      }
    }
    return { expiredReleasedUnits, expiredLots };
  }

  private async consumeAvailableLots(
    tx: CreditPolicyStoreTransaction,
    account: CreditAccount,
    amountUnits: bigint,
    now: number,
  ): Promise<void> {
    let remaining = amountUnits;
    const lots = (
      await tx.listCreditLots({
        projectId: this.projectId,
        customerId: account.customerId,
      })
    )
      .filter((lot) => lot.accountId === account.id && parseCreditUnits(lot.availableUnits) > 0n)
      .sort(compareCreditLots);
    for (const lot of lots) {
      if (remaining === 0n) break;
      const available = parseCreditUnits(lot.availableUnits);
      const consumed = available < remaining ? available : remaining;
      await tx.saveCreditLot(
        withCreditLotBalances(
          lot,
          available - consumed,
          parseCreditUnits(lot.reservedUnits),
          parseCreditUnits(lot.consumedUnits) + consumed,
          parseCreditUnits(lot.expiredUnits),
          now,
        ),
      );
      remaining -= consumed;
    }
    if (remaining !== 0n) {
      throw new InvalidCreditStateError(
        `Credit lot balance is missing ${remaining.toString()} units for account ${account.id}`,
      );
    }
  }

  private async ensureAccountInTransaction(
    tx: CreditStoreTransaction,
    customerIdValue: string,
    metadata?: Record<string, unknown>,
  ): Promise<CreditAccount> {
    const customerId = requireText(customerIdValue, 'customerId');
    const existing = await tx.getAccountByCustomer(this.projectId, customerId);
    if (existing) return existing;
    const now = this.now();
    const account = withBalances(
      {
        id: deterministicAccountId(this.projectId, customerId),
        projectId: this.projectId,
        customerId,
        currency: 'USD',
        postedUnits: '0',
        reservedUnits: '0',
        availableUnits: '0',
        postedAmount: '0',
        reservedAmount: '0',
        availableAmount: '0',
        createdAt: now,
        updatedAt: now,
        metadata,
      },
      0n,
      0n,
      now,
    );
    await tx.saveAccount(account);
    return account;
  }

  private async expireOpenReservations(
    tx: CreditStoreTransaction,
    now: number,
    customerId?: string,
  ): Promise<CreditReservation[]> {
    const open = await tx.listReservations({
      projectId: this.projectId,
      customerId,
      status: 'open',
    });
    const expired: CreditReservation[] = [];
    for (const reservation of open.filter((item) => item.expiresAt <= now)) {
      const result = await this.expireReservation(tx, reservation, now);
      expired.push(result.reservation);
    }
    return expired;
  }

  private expireReservation(
    tx: CreditStoreTransaction,
    reservation: CreditReservation,
    now: number,
  ) {
    return this.closeReservation(tx, reservation, 'expired', now, 'ttl_expired');
  }

  private async closeReservation(
    tx: CreditStoreTransaction,
    reservation: CreditReservation,
    status: 'released' | 'expired',
    now: number,
    reason?: string,
  ) {
    if (isPolicyTransaction(tx)) {
      await this.expireDueCreditLots(tx, now, reservation.customerId);
    }
    const accountBefore = await this.requireAccountById(tx, reservation.accountId);
    const reservedUnits = parseCreditUnits(reservation.reservedUnits);
    const lotResult = isPolicyTransaction(tx)
      ? await this.releaseCreditLotAllocations(tx, reservation, now)
      : { expiredReleasedUnits: 0n, expiredLots: [] };
    const account = withBalances(
      accountBefore,
      parseCreditUnits(accountBefore.postedUnits) - lotResult.expiredReleasedUnits,
      parseCreditUnits(accountBefore.reservedUnits) - reservedUnits,
      now,
    );
    const closed: CreditReservation = {
      ...reservation,
      status,
      releasedAmount: reservation.reservedAmount,
      releasedUnits: reservation.reservedUnits,
      closedAt: now,
    };
    await tx.saveReservation(closed);
    await tx.saveAccount(account);
    await this.saveLedgerEntry(
      tx,
      account,
      'release',
      'reserved',
      -reservedUnits,
      'reservation',
      reservation.id,
      now,
      { reason },
    );
    for (const expired of lotResult.expiredLots) {
      await this.saveLedgerEntry(
        tx,
        account,
        'expire',
        'posted',
        -expired.units,
        'credit_lot',
        expired.lot.id,
        now,
        { reason: 'released_after_expiry', reservationId: reservation.id },
      );
      await this.saveOutboxEvent(
        tx,
        'credit.lot.expired',
        { account, lot: expired.lot, expiredUnits: expired.units.toString() },
        now,
      );
    }
    await this.saveOutboxEvent(
      tx,
      status === 'expired' ? 'credit.expired' : 'credit.released',
      { account, reservation: closed, reason },
      now,
    );
    return { reservation: closed, balance: account };
  }

  private async idempotent<T>(
    tx: CreditStoreTransaction,
    operation: string,
    keyValue: string,
    request: unknown,
    handler: () => Promise<T>,
  ): Promise<T> {
    const key = requireText(keyValue, 'idempotencyKey');
    const scope = `${this.projectId}:${operation}`;
    const requestHash = hashRequest(request);
    const existing = await tx.getIdempotencyRecord(scope, key);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyConflictError(key);
      return structuredClone(existing.result) as T;
    }
    const result = await handler();
    await tx.saveIdempotencyRecord({
      scope,
      key,
      requestHash,
      result: structuredClone(result),
      createdAt: this.now(),
    });
    return result;
  }

  private async saveLedgerEntry(
    tx: CreditStoreTransaction,
    account: CreditAccount,
    type: LedgerEntryType,
    bucket: LedgerBucket,
    delta: bigint,
    referenceType: LedgerEntry['referenceType'],
    referenceId: string,
    createdAt: number,
    metadata?: Record<string, unknown>,
  ): Promise<LedgerEntry> {
    const entry: LedgerEntry = {
      id: createId('le'),
      accountId: account.id,
      projectId: account.projectId,
      customerId: account.customerId,
      type,
      bucket,
      deltaUnits: delta.toString(),
      balanceAfterUnits: bucket === 'posted' ? account.postedUnits : account.reservedUnits,
      referenceType,
      referenceId,
      createdAt,
      metadata,
    };
    await tx.saveLedgerEntry(entry);
    return entry;
  }

  private async saveOutboxEvent<T>(
    tx: CreditStoreTransaction,
    type: CreditEventType,
    data: T,
    createdAt: number,
  ): Promise<void> {
    await tx.saveOutboxEvent({
      id: createId('evt'),
      projectId: this.projectId,
      type,
      data,
      status: 'pending',
      createdAt,
      attemptCount: 0,
      nextAttemptAt: createdAt,
    });
  }

  private async requirePrice(tx: CreditStoreTransaction, id: string): Promise<PriceVersion> {
    const price = await tx.getPriceVersion(id);
    if (!price || price.projectId !== this.projectId)
      throw new CreditNotFoundError('Price version', id);
    return price;
  }
  private async requireReservation(
    tx: CreditStoreTransaction,
    id: string,
  ): Promise<CreditReservation> {
    const value = await tx.getReservation(id);
    if (!value || value.projectId !== this.projectId)
      throw new CreditNotFoundError('Reservation', id);
    return value;
  }
  private async requireAccountById(tx: CreditStoreTransaction, id: string): Promise<CreditAccount> {
    const value = await tx.getAccount(id);
    if (!value || value.projectId !== this.projectId)
      throw new CreditNotFoundError('Credit account', id);
    return value;
  }
  private async requireUsageReceipt(id: string): Promise<UsageReceipt> {
    const value = await this.store.getUsageReceipt(id);
    if (!value || value.projectId !== this.projectId)
      throw new CreditNotFoundError('Usage receipt', id);
    return value;
  }

  private forCurrentProject<T extends { projectId: string }>(value: T | undefined): T | undefined {
    return value?.projectId === this.projectId ? value : undefined;
  }

  private forCurrentProjectList<T extends { projectId: string }>(values: T[]): T[] {
    return values.filter((value) => value.projectId === this.projectId);
  }
}

function withBalances(
  account: CreditAccount,
  posted: bigint,
  reserved: bigint,
  updatedAt: number,
): CreditAccount {
  if (posted < 0n || reserved < 0n || reserved > posted) {
    throw new InvalidCreditStateError('Credit account invariant violated');
  }
  const available = posted - reserved;
  return {
    ...account,
    postedUnits: posted.toString(),
    reservedUnits: reserved.toString(),
    availableUnits: available.toString(),
    postedAmount: creditUnitsToString(posted),
    reservedAmount: creditUnitsToString(reserved),
    availableAmount: creditUnitsToString(available),
    updatedAt,
  };
}

function isPolicyTransaction(
  transaction: CreditStoreTransaction | CreditPolicyStoreTransaction,
): transaction is CreditPolicyStoreTransaction {
  const value = transaction as Partial<CreditPolicyStoreTransaction>;
  return (
    typeof value.getGrantPolicy === 'function' &&
    typeof value.listGrantPolicies === 'function' &&
    typeof value.getCreditLot === 'function' &&
    typeof value.listCreditLots === 'function' &&
    typeof value.listCreditLotAllocations === 'function' &&
    typeof value.getGrantPolicyApplicationByIdentity === 'function' &&
    typeof value.saveGrantPolicy === 'function' &&
    typeof value.saveCreditLot === 'function' &&
    typeof value.saveCreditLotAllocation === 'function' &&
    typeof value.saveGrantPolicyApplication === 'function'
  );
}

function createCreditLot(input: {
  account: CreditAccount;
  kind: CreditLotKind;
  amountUnits: bigint;
  grantId?: string;
  policyId?: string;
  expiresAt?: number;
  now: number;
  metadata?: Record<string, unknown>;
}): CreditLot {
  if (input.amountUnits <= 0n) {
    throw new InvalidCreditStateError('Credit lot amount must be positive');
  }
  if (input.expiresAt !== undefined && input.expiresAt <= input.now) {
    throw new InvalidCreditStateError('Credit lot expiry must be in the future');
  }
  const amount = creditUnitsToString(input.amountUnits);
  return {
    id: createId('lot'),
    accountId: input.account.id,
    projectId: input.account.projectId,
    customerId: input.account.customerId,
    kind: input.kind,
    grantId: input.grantId,
    policyId: input.policyId,
    originalAmount: amount,
    originalUnits: input.amountUnits.toString(),
    availableAmount: amount,
    availableUnits: input.amountUnits.toString(),
    reservedAmount: '0',
    reservedUnits: '0',
    consumedAmount: '0',
    consumedUnits: '0',
    expiredAmount: '0',
    expiredUnits: '0',
    createdAt: input.now,
    updatedAt: input.now,
    expiresAt: input.expiresAt,
    metadata: input.metadata,
  };
}

function withCreditLotBalances(
  lot: CreditLot,
  available: bigint,
  reserved: bigint,
  consumed: bigint,
  expired: bigint,
  updatedAt: number,
): CreditLot {
  if (available < 0n || reserved < 0n || consumed < 0n || expired < 0n) {
    throw new InvalidCreditStateError(`Credit lot balance cannot be negative: ${lot.id}`);
  }
  const original = parseCreditUnits(lot.originalUnits);
  if (available + reserved + consumed + expired !== original) {
    throw new InvalidCreditStateError(`Credit lot invariant violated: ${lot.id}`);
  }
  return {
    ...lot,
    availableAmount: creditUnitsToString(available),
    availableUnits: available.toString(),
    reservedAmount: creditUnitsToString(reserved),
    reservedUnits: reserved.toString(),
    consumedAmount: creditUnitsToString(consumed),
    consumedUnits: consumed.toString(),
    expiredAmount: creditUnitsToString(expired),
    expiredUnits: expired.toString(),
    updatedAt,
  };
}

function createCreditLotAllocation(input: {
  reservationId: string;
  lot: CreditLot;
  amountUnits: bigint;
  now: number;
}): CreditLotAllocation {
  if (input.amountUnits <= 0n) {
    throw new InvalidCreditStateError('Credit lot allocation amount must be positive');
  }
  const amount = creditUnitsToString(input.amountUnits);
  return {
    id: `cla_${createHash('sha256')
      .update(`${input.reservationId}\u0000${input.lot.id}`)
      .digest('hex')
      .slice(0, 24)}`,
    reservationId: input.reservationId,
    lotId: input.lot.id,
    accountId: input.lot.accountId,
    projectId: input.lot.projectId,
    customerId: input.lot.customerId,
    allocatedAmount: amount,
    allocatedUnits: input.amountUnits.toString(),
    reservedAmount: amount,
    reservedUnits: input.amountUnits.toString(),
    consumedAmount: '0',
    consumedUnits: '0',
    releasedAmount: '0',
    releasedUnits: '0',
    expiredAmount: '0',
    expiredUnits: '0',
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function withCreditLotAllocationBalances(
  allocation: CreditLotAllocation,
  reserved: bigint,
  consumed: bigint,
  released: bigint,
  expired: bigint,
  updatedAt: number,
): CreditLotAllocation {
  if (reserved < 0n || consumed < 0n || released < 0n || expired < 0n) {
    throw new InvalidCreditStateError(
      `Credit lot allocation balance cannot be negative: ${allocation.id}`,
    );
  }
  const allocated = parseCreditUnits(allocation.allocatedUnits);
  if (reserved + consumed + released + expired !== allocated) {
    throw new InvalidCreditStateError(`Credit lot allocation invariant violated: ${allocation.id}`);
  }
  return {
    ...allocation,
    reservedAmount: creditUnitsToString(reserved),
    reservedUnits: reserved.toString(),
    consumedAmount: creditUnitsToString(consumed),
    consumedUnits: consumed.toString(),
    releasedAmount: creditUnitsToString(released),
    releasedUnits: released.toString(),
    expiredAmount: creditUnitsToString(expired),
    expiredUnits: expired.toString(),
    updatedAt,
  };
}

function compareCreditLots(left: CreditLot, right: CreditLot): number {
  const priority = (lot: CreditLot) => {
    if (lot.kind === 'promotion') return 0;
    if (lot.kind === 'allowance') return 1;
    return 2;
  };
  const priorityDifference = priority(left) - priority(right);
  if (priorityDifference !== 0) return priorityDifference;
  if (left.kind === 'promotion' && right.kind === 'promotion') {
    const expiryDifference =
      (left.expiresAt ?? Number.MAX_SAFE_INTEGER) - (right.expiresAt ?? Number.MAX_SAFE_INTEGER);
    if (expiryDifference !== 0) return expiryDifference;
  }
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function allowancePeriodKey(timestamp: number, cadence: AllowanceCadence): string {
  if (!Number.isSafeInteger(timestamp)) throw new Error('Clock must return an integer timestamp');
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error('Clock returned an invalid timestamp');
  const day = date.toISOString().slice(0, 10);
  if (cadence === 'day') return `day:${day}`;
  if (cadence === 'month') return `month:${day.slice(0, 7)}`;
  if (cadence === 'week') {
    const utcDay = date.getUTCDay();
    const daysSinceMonday = (utcDay + 6) % 7;
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
    return `week:${monday.toISOString().slice(0, 10)}`;
  }
  throw new Error(`Unsupported allowance cadence: ${String(cadence)}`);
}

function normalizeUsage(usage: UsageQuantities): UsageQuantities {
  return Object.fromEntries(Object.entries(usage).sort(([a], [b]) => a.localeCompare(b)));
}

function toSignedCreditUnits(amount: string): bigint {
  const value = amount.trim();
  return value.startsWith('-') ? -toCreditUnits(value.slice(1)) : toCreditUnits(value);
}

function deterministicAccountId(projectId: string, customerId: string): string {
  return `acct_${createHash('sha256').update(`${projectId}\u0000${customerId}`).digest('hex').slice(0, 24)}`;
}

function createId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}
function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}
function hashRequest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}
