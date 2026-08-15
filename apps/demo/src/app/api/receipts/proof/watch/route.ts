import {
  createWatcherCursorKey,
  createReceipt,
  findMemoPaymentProof,
  stablecoinUnitsToString,
  type PaymentInvoice,
  type FindMemoPaymentProofResult,
  type MemoPaymentRequest,
} from '@resvary/sdk/receipts';
import { jsonSafeResponse, proofErrorResponse } from '../responses';
import { getDemoReceiptStore } from '../../../webhook-inbox/store';

export const dynamic = 'force-dynamic';

interface WatchProofRequest {
  invoice?: PaymentInvoice;
  paymentRequest?: MemoPaymentRequest;
  fromBlock?: string;
}

interface ValidWatchProofRequest {
  invoice: PaymentInvoice;
  paymentRequest: MemoPaymentRequest;
  fromBlock?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as WatchProofRequest;
  const proofRequest = validateWatchProofRequest(body);
  if (proofRequest instanceof Response) {
    return proofRequest;
  }

  try {
    const result = await findMemoPaymentProof({
      paymentRequest: proofRequest.paymentRequest,
      fromBlock: parseOptionalBlock(proofRequest.fromBlock),
    });
    await saveProofWatchCursor(proofRequest.invoice, proofRequest.paymentRequest, result.nextFromBlock);

    if (result.status === 'pending') {
      return jsonSafeResponse(result);
    }

    const receipt = createProofReceipt(proofRequest.invoice, result);
    return jsonSafeResponse({ ...result, receipt });
  } catch (error) {
    return proofErrorResponse(
      error,
      'Unknown proof polling error',
      'proof_polling_failed',
    );
  }
}

async function saveProofWatchCursor(
  invoice: PaymentInvoice,
  paymentRequest: MemoPaymentRequest,
  nextFromBlock: bigint,
): Promise<void> {
  const store = await getDemoReceiptStore();
  await store.saveWatcherCursor({
    key: createWatcherCursorKey({
      network: invoice.network,
      invoiceId: invoice.id,
      memoId: paymentRequest.memoId,
    }),
    invoiceId: invoice.id,
    memoId: paymentRequest.memoId,
    network: invoice.network,
    nextFromBlock,
    updatedAt: Date.now(),
    metadata: {
      source: 'demo-proof-watch',
    },
  });
}

function validateWatchProofRequest(body: WatchProofRequest): ValidWatchProofRequest | Response {
  if (!body.invoice || !body.paymentRequest) {
    return Response.json(
      { error: 'Missing invoice or payment request', reason: 'missing_payment_request' },
      { status: 400 },
    );
  }

  return {
    invoice: body.invoice,
    paymentRequest: body.paymentRequest,
    fromBlock: body.fromBlock,
  };
}

function createProofReceipt(invoice: PaymentInvoice, result: Extract<FindMemoPaymentProofResult, { status: 'found' }>) {
  return createReceipt(invoice, {
    txHash: result.proof.txHash,
    from: result.proof.payer,
    to: result.proof.payTo,
    amount: stablecoinUnitsToString(BigInt(result.proof.amountUnits)),
    currency: invoice.currency,
    network: result.proof.network,
    memo: invoice.memo,
    memoId: result.proof.memoId,
    callDataHash: result.proof.callDataHash,
    blockNumber: result.proof.blockNumber,
    onchainProof: result.proof,
    metadata: {
      source: 'arc-testnet-proof-watch',
      memoContract: result.proof.memoContract,
      memoIndex: result.proof.memoIndex,
      explorerUrl: result.proof.explorerUrl,
    },
  });
}

function parseOptionalBlock(value?: string): bigint | undefined {
  if (!value) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  return BigInt(value);
}
