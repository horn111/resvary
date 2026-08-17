import {
  CreditNotFoundError,
  signCreditOutboxEvent,
  type FundingIntent,
} from '@resvary/sdk/credits';
import { ArcCreditFunding } from '@resvary/sdk/funding/arc';
import {
  createInvoice,
  createMemoPaymentRequest,
  createReceipt,
  stablecoinUnitsToString,
  verifyMemoPaymentProof,
} from '@resvary/sdk/receipts';
import { createHash } from 'node:crypto';
import { getDemoCredits } from './store';

export const dynamic = 'force-dynamic';

const customerId = 'customer_demo';
const simulatedFundingRecipient = '0x1111111111111111111111111111111111111111' as const;
const simulatedFundingPayer = '0x2222222222222222222222222222222222222222' as const;

export async function GET() {
  return Response.json(await getState());
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      idempotencyKey?: string;
      live?: boolean;
      fundingIntentId?: string;
      txHash?: string;
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
          estimatedUsage: body.live
            ? { input_tokens: '4000', output_tokens: '1000' }
            : { input_tokens: '2000', output_tokens: '1000' },
          idempotencyKey: `run:${idempotencyKey}`,
          metadata: { mode: body.live ? 'live' : 'simulated' },
        },
        async () => (body.live ? callLiveProvider() : simulateProvider(idempotencyKey)),
      );
    } else if (body.action === 'fail') {
      try {
        await ledger.runMetered(
          {
            customerId,
            priceId: price.id,
            estimatedUsage: { input_tokens: '1000', output_tokens: '1000' },
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
      const receipt = createReceipt(fundingRequest.invoice, {
        from: simulatedFundingPayer,
        to: simulatedFundingRecipient,
        amount: '2',
        memo: fundingRequest.invoice.memo,
        txHash,
      });
      await funding.confirmPayment({
        fundingIntentId: fundingRequest.fundingIntent.id,
        receipt,
        idempotencyKey: `arc-confirm:${idempotencyKey}`,
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
    latestSignature: latestEvent
      ? signCreditOutboxEvent(
          latestEvent,
          process.env.RESVARY_WEBHOOK_SECRET ?? 'resvary-demo-secret',
        ).header
      : null,
    liveProviderConfigured: Boolean(process.env.RESVARY_AI_API_KEY && process.env.RESVARY_AI_MODEL),
    persistence: process.env.RESVARY_CREDITS_DB_PATH ?? '.resvary/demo.sqlite',
    fundingIntents,
    fundingTransactions,
    arcLiveFundingTransaction:
      fundingTransactions.findLast(
        (transaction) => transaction.metadata?.mode === 'live_arc_testnet',
      ) ?? null,
    arcLiveConfigured: Boolean(liveRecipient),
    arcFundingRequest:
      latestLiveIntent && latestLiveIntentRecipient
        ? createLiveArcRequestSummary(latestLiveIntent, latestLiveIntentRecipient)
        : null,
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

function parseTxHash(value?: string): `0x${string}` | null {
  return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as `0x${string}`) : null;
}

async function simulateProvider(idempotencyKey: string) {
  return {
    value: { text: 'A simulated answer generated by the Resvary demo.' },
    actualUsage: { input_tokens: '1260', output_tokens: '310' },
    usageEventId: `simulated:${idempotencyKey}`,
  };
}

async function callLiveProvider() {
  const apiKey = process.env.RESVARY_AI_API_KEY;
  const model = process.env.RESVARY_AI_MODEL;
  const baseUrl = (process.env.RESVARY_AI_BASE_URL ?? 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  );
  if (!apiKey || !model) throw new Error('Live provider is not configured');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Explain prepaid AI credits in one sentence.' }],
    }),
  });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const data = (await response.json()) as {
    id?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!data.id || !data.usage) throw new Error('AI provider response did not include usage');
  return {
    value: { text: data.choices?.[0]?.message?.content ?? '' },
    actualUsage: {
      input_tokens: String(data.usage.prompt_tokens ?? 0),
      output_tokens: String(data.usage.completion_tokens ?? 0),
    },
    usageEventId: data.id,
  };
}
