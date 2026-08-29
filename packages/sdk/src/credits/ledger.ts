import { createHash, randomBytes } from 'node:crypto';
import { creditUnitsToString, parseCreditUnits, toCreditUnits } from './amount.js';
import {
  CreditNotFoundError,
  IdempotencyConflictError,
  InsufficientCreditsError,
  InvalidCreditStateError,
} from './errors.js';
import { InMemoryCreditStore, type CreditStore, type CreditStoreTransaction } from './store.js';
import type {
  CreditAccount,
  CreditEventType,
  CreditGrant,
  CreditGrantSource,
  FundingEvidence,
  FundingIntent,
  FundingRail,
  FundingSettlementStatus,
  FundingTransaction,
  CreditOutboxEvent,
  CreditReservation,
  LedgerBucket,
  LedgerEntry,
  LedgerEntryType,
  MeterDefinition,
  OutboxEventFilter,
  PriceRateInput,
  PriceVersion,
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

  async grantCredits(
    input: GrantCreditsInput,
  ): Promise<{ account: CreditAccount; grant: CreditGrant }> {
    const amountUnits = toCreditUnits(input.amount);
    if (amountUnits <= 0n) throw new Error('Credit grant amount must be positive');
    const request = { ...input, amountUnits: amountUnits.toString() };

    return this.store.transaction((tx) =>
      this.idempotent(tx, 'grant_credits', input.idempotencyKey, request, async () => {
        const now = this.now();
        const current = await this.ensureAccountInTransaction(tx, input.customerId, input.metadata);
        const grant: CreditGrant = {
          id: createId('grant'),
          accountId: current.id,
          projectId: this.projectId,
          customerId: current.customerId,
          amount: creditUnitsToString(amountUnits),
          amountUnits: amountUnits.toString(),
          source: input.source ?? 'manual',
          externalRef: input.externalRef,
          createdAt: now,
          metadata: input.metadata,
        };
        const account = withBalances(
          current,
          parseCreditUnits(current.postedUnits) + amountUnits,
          parseCreditUnits(current.reservedUnits),
          now,
        );
        await tx.saveGrant(grant);
        await tx.saveAccount(account);
        await this.saveLedgerEntry(
          tx,
          account,
          'grant',
          'posted',
          amountUnits,
          'grant',
          grant.id,
          now,
          input.metadata,
        );
        await this.saveOutboxEvent(tx, 'credit.granted', { account, grant }, now);
        return { account, grant };
      }),
    );
  }

  async adjustCredits(
    input: AdjustCreditsInput,
  ): Promise<{ account: CreditAccount; entry: LedgerEntry }> {
    const deltaUnits = toSignedCreditUnits(input.amount);
    if (deltaUnits === 0n) throw new Error('Credit adjustment amount cannot be zero');
    const request = { ...input, deltaUnits: deltaUnits.toString() };

    return this.store.transaction((tx) =>
      this.idempotent(tx, 'adjust_credits', input.idempotencyKey, request, async () => {
        const now = this.now();
        const current = await this.ensureAccountInTransaction(tx, input.customerId, input.metadata);
        const nextPosted = parseCreditUnits(current.postedUnits) + deltaUnits;
        const reserved = parseCreditUnits(current.reservedUnits);
        if (nextPosted < reserved) {
          throw new InsufficientCreditsError((nextPosted - reserved).toString(), '0');
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

  async createPriceVersion(input: CreatePriceVersionInput): Promise<PriceVersion> {
    return this.store.transaction((tx) =>
      this.idempotent(tx, 'create_price_version', input.idempotencyKey, input, async () => {
        const meter = await tx.getMeterByKey(this.projectId, input.meterKey);
        if (!meter) throw new CreditNotFoundError('Meter', input.meterKey);
        const versions = await tx.listPriceVersions(meter.id);
        const price = createPriceVersion({
          id: createId('price'),
          projectId: this.projectId,
          meter,
          version: versions.reduce((max, item) => Math.max(max, item.version), 0) + 1,
          rates: input.rates,
          createdAt: this.now(),
          metadata: input.metadata,
        });
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

    return this.store.transaction(async (tx) => {
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
    return this.store.transaction((tx) =>
      this.idempotent(tx, 'reserve_credits', input.idempotencyKey, input, async () => {
        const now = this.now();
        await this.expireOpenReservations(tx, now, input.customerId);
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
    return this.store.transaction((tx) =>
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

        const accountBefore = await this.requireAccountById(tx, reservation.accountId);
        const postedBefore = parseCreditUnits(accountBefore.postedUnits);
        const reservedBefore = parseCreditUnits(accountBefore.reservedUnits);
        const account = withBalances(
          accountBefore,
          postedBefore - chargeUnits,
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
    return this.store.transaction((tx) =>
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
    return this.store.transaction((tx) =>
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
    const account = await this.store.getAccountByCustomer(
      this.projectId,
      requireText(customerId, 'customerId'),
    );
    if (!account) throw new CreditNotFoundError('Credit account', customerId);
    return account;
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
    const accountBefore = await this.requireAccountById(tx, reservation.accountId);
    const reservedUnits = parseCreditUnits(reservation.reservedUnits);
    const account = withBalances(
      accountBefore,
      parseCreditUnits(accountBefore.postedUnits),
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
