import {
  CreditNotFoundError,
  CreditLedger,
  InMemoryCreditStore,
  signCreditOutboxEvent,
  type FundingIntent,
} from '@resvary/sdk/credits';
import { ArcCreditFunding } from '@resvary/sdk/funding/arc';
import {
  ARC_GATEWAY_TESTNET,
  GatewayNanopaymentFunding,
  type GatewayFacilitator,
  type GatewayPaymentPayload,
  type GatewayPaymentRequirements,
} from '@resvary/circle';
import {
  createInvoice,
  createMemoPaymentRequest,
  createReceipt,
  stablecoinUnitsToString,
  verifyMemoPaymentProof,
} from '@resvary/sdk/receipts';
import { createHash } from 'node:crypto';
import { requireDemoMutationAuthorization } from '../demo-auth';
import { getDemoCredits } from './store';

export const dynamic = 'force-dynamic';

const customerId = 'customer_demo';
const simulatedFundingRecipient = '0x1111111111111111111111111111111111111111' as const;
const simulatedFundingPayer = '0x2222222222222222222222222222222222222222' as const;

export async function GET() {
  return Response.json(await getState());
}

export async function POST(request: Request) {
  const denied = requireDemoMutationAuthorization(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as {
      action?: string;
      idempotencyKey?: string;
      fundingIntentId?: string;
      txHash?: string;
      paymentPayload?: GatewayPaymentPayload;
    };
    const { ledger, price } = await getDemoCredits();
    const idempotencyKey = body.idempotencyKey ?? crypto.randomUUID();

    if (body.action === 'grant') {
      await ledger.grantCredits({
        customerId,
        amount: '5',
        idempotencyKey: `grant:${idempotencyKey}`,
      });
    } else if (body.action === 'run') {
      await ledger.runMetered(
        {
          customerId,
          priceId: price.id,
          estimatedUsage: { input_tokens: '2000', output_tokens: '1000', images: '11' },
          idempotencyKey: `run:${idempotencyKey}`,
          metadata: { mode: 'simulated' },
        },
        async () => simulateProvider(idempotencyKey),
      );
    } else if (body.action === 'fail') {
      try {
        await ledger.runMetered(
          {
            customerId,
            priceId: price.id,
            estimatedUsage: { input_tokens: '1000', output_tokens: '1000', images: '10' },
            idempotencyKey: `fail:${idempotencyKey}`,
            metadata: { mode: 'simulated_failure' },
          },
          async () => {
            throw new Error('Simulated provider timeout');
          },
        );
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'Simulated provider timeout')
          throw error;
      }
    } else if (body.action === 'arc') {
      const funding = new ArcCreditFunding({ ledger, payTo: simulatedFundingRecipient });
      const fundingRequest = await funding.createFundingRequest({
        customerId,
        amount: '2',
        idempotencyKey: `arc-intent:${idempotencyKey}`,
        metadata: { mode: 'simulated_arc_testnet' },
      });
      const txHash =
        `0x${createHash('sha256').update(idempotencyKey).digest('hex')}` as `0x${string}`;
      await ledger.confirmFunding({
        fundingIntentId: fundingRequest.fundingIntent.id,
        rail: 'arc_direct',
        network: fundingRequest.fundingIntent.network,
        externalPaymentId: `simulated:${txHash}`,
        amount: '2',
        paymentReceiptId: `simulated:${txHash}`,
        payer: simulatedFundingPayer,
        idempotencyKey: `arc-confirm:${idempotencyKey}`,
        metadata: { mode: 'simulated_arc_testnet', simulated: true },
      });
    } else if (body.action === 'gateway_prepare') {
      const funding = createDemoGatewayFunding(ledger);
      await funding.createFundingRequest({
        customerId,
        amount: '2',
        expectedPayer: simulatedFundingPayer,
        idempotencyKey: `gateway-intent:${idempotencyKey}`,
        metadata: { mode: 'simulated_gateway_nanopayment' },
      });
    } else if (body.action === 'gateway_settle' || body.action === 'gateway_replay') {
      if (!body.fundingIntentId) throw new Error('Create a Gateway funding request first');
      const intent = await ledger.getFundingIntent(body.fundingIntentId);
      if (
        !intent ||
        intent.customerId !== customerId ||
        intent.rail !== 'circle_gateway_nanopayment' ||
        intent.metadata?.mode !== 'simulated_gateway_nanopayment'
      ) {
        throw new Error('Gateway funding intent was not found');
      }
      const funding = createDemoGatewayFunding(ledger);
      await funding.verifySettleAndCredit({
        fundingIntentId: intent.id,
        paymentPayload: body.paymentPayload ?? createDemoGatewayPayload(intent),
        idempotencyKey: `gateway-settle:${idempotencyKey}`,
        metadata: { mode: 'simulated_gateway_nanopayment' },
      });
    } else if (body.action === 'arc_prepare') {
      const liveRecipient = requireLiveArcFundingRecipient();
      const funding = new ArcCreditFunding({ ledger, payTo: liveRecipient });
      await funding.createFundingRequest({
        customerId,
        amount: '2',
        idempotencyKey: `arc-live-intent:${idempotencyKey}`,
        metadata: { mode: 'live_arc_testnet', payTo: liveRecipient },
      });
    } else if (body.action === 'arc_confirm') {
      const txHash = parseTxHash(body.txHash);
      if (!txHash) throw new Error('Enter a valid Arc Testnet transaction hash');
      if (!body.fundingIntentId) throw new Error('Create an Arc funding request first');

      const intent = await ledger.getFundingIntent(body.fundingIntentId);
      if (
        !intent ||
        intent.customerId !== customerId ||
        intent.metadata?.mode !== 'live_arc_testnet'
      ) {
        throw new Error('Live Arc funding intent was not found');
      }

      const intentRecipient = getLiveFundingIntentRecipient(intent);
      if (!intentRecipient) throw new Error('Live Arc funding intent has no valid recipient');
      const invoice = createLiveArcInvoice(intent, intentRecipient);
      const paymentRequest = createMemoPaymentRequest(invoice);
      const proof = await verifyMemoPaymentProof({ txHash, paymentRequest });
      const receipt = createReceipt(invoice, {
        txHash: proof.txHash,
        from: proof.payer,
        to: proof.payTo,
        amount: stablecoinUnitsToString(BigInt(proof.amountUnits)),
        currency: invoice.currency,
        network: proof.network,
        memo: invoice.memo,
        memoId: proof.memoId,
        callDataHash: proof.callDataHash,
        blockNumber: proof.blockNumber,
        onchainProof: proof,
        metadata: {
          source: 'arc-testnet-live-credit-funding',
          explorerUrl: proof.explorerUrl,
        },
      });
      const funding = new ArcCreditFunding({ ledger, payTo: intentRecipient });
      await funding.confirmPayment({
        fundingIntentId: intent.id,
        receipt,
        idempotencyKey: `arc-live-confirm:${intent.id}:${txHash.toLowerCase()}`,
        metadata: {
          mode: 'live_arc_testnet',
          explorerUrl: proof.explorerUrl,
          blockNumber: proof.blockNumber.toString(),
          memoId: proof.memoId,
        },
      });
    } else {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    return Response.json(await getState());
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Credit operation failed',
        state: await getState(),
      },
      { status: 409 },
    );
  }
}

async function getState() {
  const { ledger, price } = await getDemoCredits();
  let balance = null;
  try {
    balance = await ledger.getBalance(customerId);
  } catch (error) {
    if (!(error instanceof CreditNotFoundError)) throw error;
  }
  const outboxEvents = await ledger.listOutboxEvents();
  const latestEvent = outboxEvents.at(-1);
  const fundingIntents = await ledger.listFundingIntents();
  const fundingTransactions = await ledger.listFundingTransactions();
  const liveRecipient = getLiveArcFundingRecipient();
  const latestLiveIntent = fundingIntents.findLast(
    (intent) => intent.metadata?.mode === 'live_arc_testnet',
  );
  const latestGatewayIntent = fundingIntents.findLast(
    (intent) => intent.metadata?.mode === 'simulated_gateway_nanopayment',
  );
  const latestLiveIntentRecipient = latestLiveIntent
    ? getLiveFundingIntentRecipient(latestLiveIntent)
    : null;
  return {
    customerId,
    balance,
    price,
    reservations: await ledger.store.listReservations({ projectId: ledger.projectId, customerId }),
    receipts: balance ? await ledger.listUsageReceipts(customerId) : [],
    ledgerEntries: balance ? await ledger.listLedgerEntries(customerId) : [],
    outboxEvents,
    latestSignature:
      latestEvent && process.env.RESVARY_WEBHOOK_SECRET?.trim()
        ? signCreditOutboxEvent(latestEvent, process.env.RESVARY_WEBHOOK_SECRET.trim()).header
        : null,
    persistence: process.env.RESVARY_CREDITS_DB_PATH ?? '.resvary/demo.sqlite',
    fundingIntents,
    fundingTransactions,
    arcLiveFundingTransaction:
      fundingTransactions.findLast(
        (transaction) => transaction.metadata?.mode === 'live_arc_testnet',
      ) ?? null,
    arcLiveConfigured: Boolean(liveRecipient),
    gatewayFundingRequest: latestGatewayIntent
      ? createDemoGatewayRequestSummary(latestGatewayIntent)
      : null,
    gatewayFundingTransaction:
      fundingTransactions.findLast(
        (transaction) => transaction.rail === 'circle_gateway_nanopayment',
      ) ?? null,
    arcFundingRequest:
      latestLiveIntent && latestLiveIntentRecipient
        ? createLiveArcRequestSummary(latestLiveIntent, latestLiveIntentRecipient)
        : null,
    policyScenario: await createPolicyScenario(),
  };
}

async function createPolicyScenario() {
  let now = Date.UTC(2026, 7, 1, 0, 0, 0);
  const ledger = new CreditLedger({
    projectId: 'resvary_policy_demo',
    store: new InMemoryCreditStore(),
    now: () => now,
  });
  const meter = await ledger.registerMeter({
    key: 'jobs',
    dimensions: ['jobs'],
    idempotencyKey: 'policy-demo-meter',
  });
  const price = await ledger.createPriceVersion({
    meterKey: meter.key,
    rates: [{ dimension: 'jobs', unitSize: '1', amount: '1' }],
    idempotencyKey: 'policy-demo-price',
  });
  const allowance = await ledger.createGrantPolicy({
    type: 'allowance',
    key: 'monthly-demo',
    cadence: 'month',
    amount: '5',
    idempotencyKey: 'policy-demo-allowance',
  });
  const promotion = await ledger.createGrantPolicy({
    type: 'promotion',
    key: 'launch-demo',
    amount: '3',
    expiresInMs: 60_000,
    idempotencyKey: 'policy-demo-promotion',
  });
  const allowanceResult = await ledger.applyAllowance({
    policyId: allowance.id,
    customerId: 'policy_demo_customer',
    idempotencyKey: 'policy-demo-allowance-august',
  });
  const promotionResult = await ledger.claimPromotion({
    policyId: promotion.id,
    customerId: 'policy_demo_customer',
    idempotencyKey: 'policy-demo-promotion-claim',
  });
  await ledger.grantCredits({
    customerId: 'policy_demo_customer',
    amount: '2',
    idempotencyKey: 'policy-demo-general',
  });
  const reservation = await ledger.reserveCredits({
    customerId: 'policy_demo_customer',
    priceId: price.id,
    estimatedUsage: { jobs: '4' },
    expiresAt: now + 120_000,
    idempotencyKey: 'policy-demo-reservation',
  });
  const reservedLots = await ledger.listCreditLots('policy_demo_customer');
  now += 60_001;
  const committed = await ledger.commitUsage({
    reservationId: reservation.id,
    usageEventId: 'policy-demo-usage',
    actualUsage: { jobs: '2' },
    idempotencyKey: 'policy-demo-commit',
  });
  return {
    monthlyAllowance: allowanceResult.application,
    promotionClaim: promotionResult.application,
    priorityAtReserve: reservedLots.map((lot) => ({
      kind: lot.kind,
      expiresAt: lot.expiresAt,
      availableAmount: lot.availableAmount,
      reservedAmount: lot.reservedAmount,
    })),
    committedAfterPromotionExpiry: {
      receiptAllocations: committed.receipt.allocations,
      balance: committed.balance,
      lots: await ledger.listCreditLots('policy_demo_customer'),
    },
  };
}

function createLiveArcRequestSummary(intent: FundingIntent, payTo: `0x${string}`) {
  const invoice = createLiveArcInvoice(intent, payTo);
  return {
    fundingIntentId: intent.id,
    status: intent.status,
    amount: intent.requestedAmount,
    invoice,
    paymentRequest: createMemoPaymentRequest(invoice),
  };
}

function getLiveFundingIntentRecipient(intent: FundingIntent): `0x${string}` | null {
  const value = intent.metadata?.payTo;
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? (value as `0x${string}`)
    : null;
}

function createLiveArcInvoice(intent: FundingIntent, payTo: `0x${string}`) {
  return createInvoice({
    id: intent.invoiceId,
    amount: intent.requestedAmount,
    currency: 'USDC',
    payTo,
    network: intent.network,
    customerId: intent.customerId,
    description: `Prepaid credits for ${intent.customerId}`,
    createdAt: intent.createdAt,
    metadata: intent.metadata,
  });
}

function requireLiveArcFundingRecipient(): `0x${string}` {
  const recipient = getLiveArcFundingRecipient();
  if (!recipient) {
    throw new Error('Live Arc funding requires RESVARY_ARC_FUNDING_RECIPIENT');
  }
  return recipient;
}

function getLiveArcFundingRecipient(): `0x${string}` | null {
  const value = process.env.RESVARY_ARC_FUNDING_RECIPIENT?.trim();
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as `0x${string}`) : null;
}

function createDemoGatewayFunding(ledger: Awaited<ReturnType<typeof getDemoCredits>>['ledger']) {
  return new GatewayNanopaymentFunding({
    ledger,
    sellerAddress: simulatedFundingRecipient,
    facilitator: demoGatewayFacilitator,
    resourceUrl: '/api/credits',
  });
}

const demoGatewayFacilitator: GatewayFacilitator = {
  async getSupported() {
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: ARC_GATEWAY_TESTNET.scheme,
          network: ARC_GATEWAY_TESTNET.network,
          extra: { verifyingContract: ARC_GATEWAY_TESTNET.gatewayWallet },
        },
      ],
      extensions: [],
      signers: {},
    };
  },
  async verify(paymentPayload) {
    return {
      isValid: Boolean(paymentPayload.payload.signature),
      payer: simulatedFundingPayer,
    };
  },
  async settle(paymentPayload, requirements) {
    const authorization = paymentPayload.payload.authorization;
    const reference = createHash('sha256')
      .update(String(authorization?.nonce ?? 'missing'))
      .digest('hex');
    return {
      success: true,
      payer: simulatedFundingPayer,
      transaction: `0x${reference}`,
      network: ARC_GATEWAY_TESTNET.network,
      amount: requirements.amount,
    };
  },
};

function createDemoGatewayRequirements(intent: FundingIntent): GatewayPaymentRequirements {
  return {
    scheme: ARC_GATEWAY_TESTNET.scheme,
    network: ARC_GATEWAY_TESTNET.network,
    asset: ARC_GATEWAY_TESTNET.usdcAddress,
    amount: intent.requestedUnits,
    payTo: simulatedFundingRecipient,
    maxTimeoutSeconds: ARC_GATEWAY_TESTNET.authorizationValiditySeconds,
    extra: {
      name: ARC_GATEWAY_TESTNET.requirementName,
      version: ARC_GATEWAY_TESTNET.requirementVersion,
      verifyingContract: ARC_GATEWAY_TESTNET.gatewayWallet,
      resvaryFundingIntentId: intent.id,
    },
  };
}

function createDemoGatewayPayload(intent: FundingIntent): GatewayPaymentPayload {
  const nonce = createHash('sha256').update(`gateway-demo:${intent.id}`).digest('hex');
  return {
    x402Version: 2,
    resource: {
      url: '/api/credits',
      description: `Fund Resvary credits for ${intent.customerId}`,
      mimeType: 'application/json',
    },
    accepted: createDemoGatewayRequirements(intent),
    payload: {
      signature: `0x${'cd'.repeat(65)}`,
      authorization: {
        from: simulatedFundingPayer,
        to: simulatedFundingRecipient,
        value: intent.requestedUnits,
        validAfter: String(Math.floor(intent.createdAt / 1_000) - 60),
        validBefore: String(
          Math.floor(
            (intent.expiresAt ??
              intent.createdAt + ARC_GATEWAY_TESTNET.authorizationValiditySeconds * 1_000) / 1_000,
          ),
        ),
        nonce: `0x${nonce}`,
      },
    },
    extensions: {
      resvary: {
        fundingIntentId: intent.id,
      },
    },
  };
}

function createDemoGatewayRequestSummary(intent: FundingIntent) {
  return {
    fundingIntentId: intent.id,
    status: intent.status,
    amount: intent.requestedAmount,
    rail: intent.rail,
    network: intent.network,
    paymentRequired: {
      x402Version: 2,
      accepts: [createDemoGatewayRequirements(intent)],
    },
    buyerCommand: 'npx tsx examples/gateway-buyer.ts --url http://localhost:3004/api/credits',
  };
}

function parseTxHash(value?: string): `0x${string}` | null {
  return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as `0x${string}`) : null;
}

async function simulateProvider(idempotencyKey: string) {
  return {
    value: { text: 'A simulated answer generated by the Resvary demo.' },
    actualUsage: { input_tokens: '1260', output_tokens: '310', images: '10' },
    usageEventId: `simulated:${idempotencyKey}`,
  };
}
