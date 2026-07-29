import {
  createReceipt,
  stablecoinUnitsToString,
  verifyMemoPaymentProof,
  type PaymentInvoice,
  type MemoPaymentRequest,
} from '@settlary/sdk/receipts';
import { jsonSafeResponse, proofErrorResponse } from './responses';

export const dynamic = 'force-dynamic';

interface ProofRequest {
  txHash?: string;
  invoice?: PaymentInvoice;
  paymentRequest?: MemoPaymentRequest;
}

interface ValidProofRequest {
  txHash: `0x${string}`;
  invoice: PaymentInvoice;
  paymentRequest: MemoPaymentRequest;
}

export async function POST(request: Request) {
  const body = (await request.json()) as ProofRequest;
  const proofRequest = validateProofRequest(body);
  if (proofRequest instanceof Response) {
    return proofRequest;
  }

  try {
    const proof = await verifyMemoPaymentProof({
      txHash: proofRequest.txHash,
      paymentRequest: proofRequest.paymentRequest,
    });
    const receipt = createReceipt(proofRequest.invoice, {
      txHash: proof.txHash,
      from: proof.payer,
      to: proof.payTo,
      amount: stablecoinUnitsToString(BigInt(proof.amountUnits)),
      currency: proofRequest.invoice.currency,
      network: proof.network,
      memo: proofRequest.invoice.memo,
      memoId: proof.memoId,
      callDataHash: proof.callDataHash,
      blockNumber: proof.blockNumber,
      onchainProof: proof,
      metadata: {
        source: 'arc-testnet-proof',
        memoContract: proof.memoContract,
        memoIndex: proof.memoIndex,
        explorerUrl: proof.explorerUrl,
      },
    });

    return jsonSafeResponse({ proof, receipt });
  } catch (error) {
    return proofErrorResponse(
      error,
      'Unknown proof verification error',
      'proof_verification_failed',
    );
  }
}

function validateProofRequest(body: ProofRequest): ValidProofRequest | Response {
  const txHash = parseTxHash(body.txHash);
  if (!txHash) {
    return Response.json(
      { error: 'Missing or invalid Arc Testnet tx hash', reason: 'invalid_tx_hash' },
      { status: 400 },
    );
  }

  if (!hasPaymentRequest(body)) {
    return Response.json(
      { error: 'Missing invoice or payment request', reason: 'missing_payment_request' },
      { status: 400 },
    );
  }

  return {
    txHash,
    invoice: body.invoice,
    paymentRequest: body.paymentRequest,
  };
}

function parseTxHash(value?: string): `0x${string}` | null {
  return value && isTxHash(value) ? value : null;
}

function hasPaymentRequest(
  body: ProofRequest,
): body is ProofRequest & { invoice: PaymentInvoice; paymentRequest: MemoPaymentRequest } {
  return Boolean(body.invoice && body.paymentRequest);
}

function isTxHash(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
