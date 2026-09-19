import { createHash } from 'node:crypto';
import { BatchFacilitatorClient, GatewayEvmScheme } from '@circle-fin/x402-batching/server';
import type { Network, PaymentRequirements } from '@x402/core/types';
import {
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_SCHEME,
  CIRCLE_BATCHING_VERSION,
} from '@circle-fin/x402-batching';
import type {
  CreditAccount,
  CreditGrant,
  CreditLedger,
  FundingIntent,
  FundingTransaction,
} from '@resvary/sdk/credits';
import {
  ARC_GATEWAY_TESTNET,
  requireArcGatewayKind,
  type ArcGatewayNetworkConfig,
  type GatewaySupportedResponse,
} from './gateway.js';

export interface GatewayPaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export interface GatewayPaymentPayload {
  x402Version: number;
  resource?: {
    url: string;
    description?: string;
    mimeType?: string;
    [key: string]: unknown;
  };
  accepted: GatewayPaymentRequirements;
  payload: {
    signature?: string;
    authorization?: {
      from?: string;
      to?: string;
      value?: string;
      validAfter?: string;
      validBefore?: string;
      nonce?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  extensions?: Record<string, unknown>;
}

export interface GatewayVerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
}

export interface GatewaySettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  transaction: string;
  network: string;
  amount?: string;
}

export interface GatewayFacilitator {
  getSupported(): Promise<GatewaySupportedResponse>;
  verify(
    paymentPayload: GatewayPaymentPayload,
    requirements: GatewayPaymentRequirements,
  ): Promise<GatewayVerifyResponse>;
  settle(
    paymentPayload: GatewayPaymentPayload,
    requirements: GatewayPaymentRequirements,
  ): Promise<GatewaySettleResponse>;
}

export interface GatewayNanopaymentFundingConfig {
  ledger: CreditLedger;
  sellerAddress: `0x${string}`;
  /** Arc network to settle on. Defaults to Testnet for backward compatibility. */
  network?: ArcGatewayNetworkConfig;
  facilitator?: GatewayFacilitator;
  facilitatorUrl?: string;
  resourceUrl?: string;
  intentTtlMs?: number;
  /** EIP-3009 authorization window advertised to clients, independent of intent expiry. */
  authorizationValiditySeconds?: number;
  now?: () => number;
}

export interface CreateGatewayFundingRequestInput {
  customerId: string;
  amount: string;
  idempotencyKey: string;
  expectedPayer?: `0x${string}`;
  metadata?: Record<string, unknown>;
}

export interface GatewayFundingRequest {
  fundingIntent: FundingIntent;
  paymentRequired: {
    x402Version: 2;
    resource: {
      url: string;
      description: string;
      mimeType: 'application/json';
    };
    accepts: [GatewayPaymentRequirements];
    extensions: {
      resvary: {
        fundingIntentId: string;
      };
    };
  };
}

export interface VerifySettleAndCreditInput {
  fundingIntentId: string;
  paymentPayload: GatewayPaymentPayload;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayFundingResult {
  account: CreditAccount;
  grant: CreditGrant;
  fundingIntent: FundingIntent;
  fundingTransaction: FundingTransaction;
  verification: GatewayVerifyResponse;
  settlement: GatewaySettleResponse;
  replayed: boolean;
}

export class GatewayNanopaymentFunding {
  private readonly ledger: CreditLedger;
  private readonly sellerAddress: `0x${string}`;
  private readonly network: ArcGatewayNetworkConfig;
  private readonly facilitator: GatewayFacilitator;
  private readonly paymentScheme = new GatewayEvmScheme();
  private readonly resourceUrl: string;
  private readonly intentTtlMs: number;
  private readonly authorizationValiditySeconds: number;
  private readonly now: () => number;

  constructor(config: GatewayNanopaymentFundingConfig) {
    this.ledger = config.ledger;
    this.sellerAddress = normalizeAddress(config.sellerAddress, 'sellerAddress');
    this.network = config.network ?? ARC_GATEWAY_TESTNET;
    this.facilitator =
      config.facilitator ??
      (new BatchFacilitatorClient({
        url: config.facilitatorUrl ?? this.network.facilitatorUrl,
      }) as unknown as GatewayFacilitator);
    this.resourceUrl = config.resourceUrl ?? '/api/credits/gateway';
    this.intentTtlMs = config.intentTtlMs ?? this.network.authorizationValiditySeconds * 1_000;
    this.authorizationValiditySeconds =
      config.authorizationValiditySeconds ?? this.network.authorizationValiditySeconds;
    if (
      !Number.isSafeInteger(this.authorizationValiditySeconds) ||
      this.authorizationValiditySeconds < this.network.authorizationValiditySeconds
    ) {
      throw new Error('authorizationValiditySeconds must cover the Gateway minimum window');
    }
    this.now = config.now ?? Date.now;
    if (!Number.isSafeInteger(this.intentTtlMs) || this.intentTtlMs <= 0) {
      throw new Error('intentTtlMs must be a positive integer');
    }
  }

  async createFundingRequest(
    input: CreateGatewayFundingRequestInput,
  ): Promise<GatewayFundingRequest> {
    const expectedPayer = input.expectedPayer
      ? normalizeAddress(input.expectedPayer, 'expectedPayer')
      : undefined;
    if (this.network.name === 'arc' && !expectedPayer) {
      throw new Error('Arc Mainnet Gateway funding requires an expectedPayer');
    }
    const expiresAt = this.now() + this.intentTtlMs;
    const fundingIntent = await this.ledger.createFundingIntent({
      customerId: input.customerId,
      amount: input.amount,
      rail: 'circle_gateway_nanopayment',
      network: this.network.network,
      invoiceId: `gateway:${input.idempotencyKey}`,
      expiresAt,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        ...input.metadata,
        expectedPayer,
      },
    });
    const requirements = await this.buildRequirements(fundingIntent);
    return {
      fundingIntent,
      paymentRequired: {
        x402Version: 2,
        resource: {
          url: this.resourceUrl,
          description: `Fund Resvary credits for ${input.customerId}`,
          mimeType: 'application/json',
        },
        accepts: [requirements],
        extensions: {
          resvary: {
            fundingIntentId: fundingIntent.id,
          },
        },
      },
    };
  }

  async verifySettleAndCredit(input: VerifySettleAndCreditInput): Promise<GatewayFundingResult> {
    const intent = await this.ledger.getFundingIntent(input.fundingIntentId);
    if (!intent || intent.rail !== 'circle_gateway_nanopayment') {
      throw new Error(`Gateway funding intent not found: ${input.fundingIntentId}`);
    }
    if (intent.status === 'failed') {
      throw new Error(`Gateway funding intent is failed: ${intent.id}`);
    }

    const authorization = requireAuthorization(input.paymentPayload);
    const authorizationHash = hashAuthorization(
      input.paymentPayload,
      input.paymentPayload.accepted,
    );
    const existing = await this.ledger.store.getFundingTransactionByExternalPayment(
      'circle_gateway_nanopayment',
      this.network.network,
      authorizationHash,
    );
    if (existing) {
      if (existing.fundingIntentId !== intent.id) {
        throw new Error('Gateway authorization is already assigned to another funding intent');
      }
      return this.replayResult(existing);
    }

    const requirements = await this.buildRequirements(intent);
    validatePayload(
      intent,
      requirements,
      input.paymentPayload,
      this.sellerAddress,
      this.network,
      this.now(),
    );

    const verification = await this.facilitator.verify(input.paymentPayload, requirements);
    if (!verification.isValid) {
      throw new Error(
        `Circle Gateway verification failed: ${
          verification.invalidReason ?? verification.invalidMessage ?? 'unknown reason'
        }`,
      );
    }
    const payer = normalizeAddress(verification.payer ?? authorization.from, 'verified payer');
    validateExpectedPayer(intent, payer);

    const settlement = await this.facilitator.settle(input.paymentPayload, requirements);
    if (!settlement.success) {
      throw new Error(
        `Circle Gateway settlement failed: ${
          settlement.errorReason ?? settlement.errorMessage ?? 'unknown reason'
        }`,
      );
    }
    if (settlement.network !== this.network.network) {
      throw new Error(`Gateway settled on unexpected network: ${settlement.network}`);
    }
    if (settlement.amount !== undefined && settlement.amount !== intent.requestedUnits) {
      throw new Error(
        `Gateway settled amount mismatch: ${settlement.amount} !== ${intent.requestedUnits}`,
      );
    }

    const credited = await this.ledger.confirmFunding({
      fundingIntentId: intent.id,
      rail: 'circle_gateway_nanopayment',
      network: this.network.network,
      externalPaymentId: authorizationHash,
      txHash: isHexTransaction(settlement.transaction)
        ? (settlement.transaction as `0x${string}`)
        : undefined,
      amount: intent.requestedAmount,
      paymentReceiptId: `circle-gateway:${authorizationHash}`,
      payer,
      settlementStatus: 'settled',
      settledAt: this.now(),
      requireExactAmount: true,
      evidence: {
        authorizationHash,
        nonce: authorization.nonce as `0x${string}`,
        payer,
        recipient: this.sellerAddress,
        facilitatorReference: settlement.transaction,
        metadata: {
          gatewayDomain: this.network.gatewayDomain,
          verifyingContract: requirements.extra.verifyingContract,
        },
      },
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    });

    return {
      ...credited,
      verification,
      settlement,
      replayed: false,
    };
  }

  async markReconciliationRequired(
    fundingTransactionId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<FundingTransaction> {
    return this.ledger.updateFundingSettlement({
      fundingTransactionId,
      status: 'reconciliation_required',
      reason,
      idempotencyKey,
    });
  }

  private async buildRequirements(intent: FundingIntent): Promise<GatewayPaymentRequirements> {
    const supported = await this.facilitator.getSupported();
    const kind = requireArcGatewayKind(supported, this.network);
    const baseRequirements: PaymentRequirements = {
      scheme: CIRCLE_BATCHING_SCHEME,
      network: this.network.network as Network,
      asset: this.network.usdcAddress,
      amount: intent.requestedUnits,
      payTo: this.sellerAddress,
      maxTimeoutSeconds: this.authorizationValiditySeconds,
      extra: {
        name: CIRCLE_BATCHING_NAME,
        version: CIRCLE_BATCHING_VERSION,
        resvaryFundingIntentId: intent.id,
      },
    };
    const enhanced = await this.paymentScheme.enhancePaymentRequirements(
      baseRequirements,
      {
        ...kind,
        network: kind.network as Network,
      },
      supported.extensions,
    );
    return {
      ...enhanced,
      extra: {
        ...enhanced.extra,
        resvaryFundingIntentId: intent.id,
      },
    } as GatewayPaymentRequirements;
  }

  private async replayResult(transaction: FundingTransaction): Promise<GatewayFundingResult> {
    const intent = await this.ledger.getFundingIntent(transaction.fundingIntentId);
    const account = await this.ledger.store.getAccount(transaction.accountId);
    const grant = await this.ledger.store.getGrant(transaction.grantId);
    if (!intent || !account || !grant) {
      throw new Error('Stored Gateway funding replay is incomplete');
    }
    return {
      account,
      grant,
      fundingIntent: intent,
      fundingTransaction: transaction,
      verification: {
        isValid: true,
        payer: transaction.payer,
      },
      settlement: {
        success: transaction.settlementStatus === 'settled',
        payer: transaction.payer,
        transaction: transaction.evidence?.facilitatorReference ?? transaction.externalPaymentId,
        network: transaction.network,
        amount: transaction.amountUnits,
      },
      replayed: true,
    };
  }
}

function validatePayload(
  intent: FundingIntent,
  requirements: GatewayPaymentRequirements,
  payload: GatewayPaymentPayload,
  sellerAddress: `0x${string}`,
  network: ArcGatewayNetworkConfig,
  now: number,
): void {
  if (payload.x402Version !== 2) throw new Error('Gateway payment must use x402 version 2');
  const accepted = payload.accepted;
  if (!accepted) throw new Error('Gateway payment is missing accepted requirements');
  if (accepted.scheme !== CIRCLE_BATCHING_SCHEME)
    throw new Error(`Unsupported Gateway scheme: ${accepted.scheme}`);
  if (accepted.network !== network.network)
    throw new Error(`Unsupported Gateway network: ${accepted.network}`);
  if (accepted.asset.toLowerCase() !== network.usdcAddress.toLowerCase())
    throw new Error(`Gateway payment asset is not ${network.name} USDC`);
  if (accepted.payTo.toLowerCase() !== sellerAddress.toLowerCase())
    throw new Error('Gateway payment recipient does not match the seller');
  if (accepted.amount !== intent.requestedUnits)
    throw new Error(
      `Gateway payment amount mismatch: ${accepted.amount} !== ${intent.requestedUnits}`,
    );
  if (accepted.extra?.name !== CIRCLE_BATCHING_NAME)
    throw new Error('Gateway batching name is invalid');
  if (accepted.extra?.version !== CIRCLE_BATCHING_VERSION)
    throw new Error('Gateway batching version is invalid');
  if (accepted.extra?.resvaryFundingIntentId !== intent.id)
    throw new Error('Gateway payment is not bound to this funding intent');
  if (!sameRequirements(accepted, requirements))
    throw new Error('Gateway accepted requirements differ from the funding request');

  const authorization = requireAuthorization(payload);
  if (authorization.to.toLowerCase() !== sellerAddress.toLowerCase())
    throw new Error('Gateway authorization recipient does not match the seller');
  if (authorization.value !== intent.requestedUnits)
    throw new Error('Gateway authorization amount must equal the funding intent amount');
  if (!/^0x[0-9a-fA-F]{64}$/.test(authorization.nonce))
    throw new Error('Gateway authorization nonce must be a 32-byte hex value');
  const validBeforeMs = Number(BigInt(authorization.validBefore)) * 1_000;
  const validAfterMs = Number(BigInt(authorization.validAfter)) * 1_000;
  if (!Number.isSafeInteger(validBeforeMs) || validBeforeMs <= now)
    throw new Error('Gateway authorization is expired');
  if (!Number.isSafeInteger(validAfterMs) || validAfterMs > now)
    throw new Error('Gateway authorization is not valid yet');
  if (intent.expiresAt !== undefined && intent.expiresAt <= now)
    throw new Error('Gateway funding intent is expired');
}

function requireAuthorization(payload: GatewayPaymentPayload): {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
} {
  const authorization = payload.payload?.authorization;
  if (!authorization) throw new Error('Gateway payment is missing authorization');
  for (const key of ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'] as const) {
    if (typeof authorization[key] !== 'string' || authorization[key]!.length === 0) {
      throw new Error(`Gateway authorization is missing ${key}`);
    }
  }
  normalizeAddress(authorization.from!, 'authorization.from');
  normalizeAddress(authorization.to!, 'authorization.to');
  return authorization as {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
}

function validateExpectedPayer(intent: FundingIntent, payer: `0x${string}`): void {
  const expected = intent.metadata?.expectedPayer;
  if (typeof expected === 'string' && expected.toLowerCase() !== payer.toLowerCase()) {
    throw new Error('Verified Gateway payer does not match the funding intent');
  }
}

function sameRequirements(
  left: GatewayPaymentRequirements,
  right: GatewayPaymentRequirements,
): boolean {
  return (
    left.scheme === right.scheme &&
    left.network === right.network &&
    left.asset.toLowerCase() === right.asset.toLowerCase() &&
    left.amount === right.amount &&
    left.payTo.toLowerCase() === right.payTo.toLowerCase() &&
    left.maxTimeoutSeconds === right.maxTimeoutSeconds &&
    left.extra?.name === right.extra?.name &&
    left.extra?.version === right.extra?.version &&
    left.extra?.verifyingContract === right.extra?.verifyingContract &&
    left.extra?.resvaryFundingIntentId === right.extra?.resvaryFundingIntentId
  );
}

function hashAuthorization(
  payload: GatewayPaymentPayload,
  requirements: GatewayPaymentRequirements,
): `0x${string}` {
  const authorization = requireAuthorization(payload);
  const canonical = JSON.stringify({
    x402Version: payload.x402Version,
    scheme: requirements.scheme,
    network: requirements.network,
    asset: requirements.asset.toLowerCase(),
    payTo: requirements.payTo.toLowerCase(),
    authorization: {
      from: authorization.from.toLowerCase(),
      to: authorization.to.toLowerCase(),
      value: authorization.value,
      validAfter: authorization.validAfter,
      validBefore: authorization.validBefore,
      nonce: authorization.nonce.toLowerCase(),
    },
  });
  return `0x${createHash('sha256').update(canonical).digest('hex')}`;
}

function normalizeAddress(value: string, field: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${field} must be an EVM address`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function isHexTransaction(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
