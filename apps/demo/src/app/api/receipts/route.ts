import {
  createMemoPaymentRequest,
  signWebhookEvent,
} from '@settlary/sdk/receipts';
import {
  DEMO_WEBHOOK_SECRET,
  DEMO_WEBHOOK_TARGET,
  getDemoReceiptLedger,
  getDemoReceiptStoreSummary,
} from '../webhook-inbox/store';

export const dynamic = 'force-dynamic';

const DEMO_SELLER = '0x1111111111111111111111111111111111111111';
const DEMO_PAYER = '0x2222222222222222222222222222222222222222';
const DEMO_TX_HASH = '0x7a6d91b9f5b42e6f9a4d8d5c0a5f1a833f9f94c8b2e7d4d0a0e8c7b6a5f4d3c2';

export async function GET() {
  const now = Date.now();
  const ledger = await getDemoReceiptLedger();

  const invoice = await ledger.getInvoice('inv_settlary_receipts_demo')
    ?? await ledger.createInvoice({
      id: 'inv_settlary_receipts_demo',
      amount: '19.00',
      currency: 'USDC',
      network: 'arc-testnet',
      payTo: DEMO_SELLER,
      customerId: 'demo-builder-001',
      description: 'Arc Testnet watcher demo invoice',
      createdAt: now,
      expiresAt: now + 30 * 60 * 1000,
      metadata: {
        product: 'Settlary Receipts',
        source: 'demo',
      },
    });

  const paymentRequest = createMemoPaymentRequest(invoice);

  const receipt = await ledger.getReceiptByTxHash(DEMO_TX_HASH, invoice.id)
    ?? await ledger.recordPayment(invoice.id, {
      txHash: DEMO_TX_HASH,
      from: DEMO_PAYER,
      to: invoice.payTo,
      amount: invoice.amount,
      currency: invoice.currency,
      network: invoice.network,
      memo: invoice.memo,
      memoId: paymentRequest.memoId,
      callDataHash: paymentRequest.callDataHash,
      observedAt: now + 4200,
      metadata: {
        watcher: 'arc-testnet',
        memoContract: paymentRequest.memoContract,
        memoIndex: '1842',
      },
    });

  const paidEvent = (await ledger
    .listWebhookEvents())
    .find((event) => event.type === 'invoice.paid');

  if (!paidEvent) {
    return Response.json(
      { error: 'Demo failed to create invoice.paid webhook event' },
      { status: 500 },
    );
  }

  const signature = signWebhookEvent(paidEvent, DEMO_WEBHOOK_SECRET);
  const store = await getDemoReceiptStoreSummary();

  return Response.json({
    generatedAt: new Date().toISOString(),
    mode: 'local simulation of the Arc Testnet watcher flow',
    store,
    invoice: {
      id: invoice.id,
      status: 'paid',
      amount: invoice.amount,
      amountUnits: invoice.amountUnits,
      currency: invoice.currency,
      network: invoice.network,
      payTo: invoice.payTo,
      memo: invoice.memo,
      memoId: invoice.memoId,
      memoData: invoice.memoData,
      paymentUri: invoice.paymentUri,
      expiresAt: invoice.expiresAt,
    },
    paymentRequest: {
      invoiceId: paymentRequest.invoiceId,
      memoContract: paymentRequest.memoContract,
      target: paymentRequest.target,
      payTo: paymentRequest.payTo,
      amountUnits: paymentRequest.amountUnits,
      memoId: paymentRequest.memoId,
      memoData: paymentRequest.memoData,
      callDataHash: paymentRequest.callDataHash,
      txData: paymentRequest.txData,
    },
    watcher: {
      network: 'arc-testnet',
      event: 'Memo',
      memoContract: paymentRequest.memoContract,
      confirmationBlocks: 0,
      pollIntervalMs: 3000,
    },
    receipt: {
      id: receipt.id,
      invoiceId: receipt.invoiceId,
      status: receipt.status,
      amount: receipt.amount,
      amountUnits: receipt.amountUnits,
      currency: receipt.currency,
      network: receipt.network,
      payTo: receipt.payTo,
      payer: receipt.payer,
      txHash: receipt.txHash,
      memo: receipt.memo,
      createdAt: receipt.createdAt,
      metadata: receipt.metadata,
    },
    webhook: {
      eventId: paidEvent.id,
      type: paidEvent.type,
      event: paidEvent,
      signatureHeader: signature.header,
      target: DEMO_WEBHOOK_TARGET,
    },
    timeline: [
      {
        id: 'invoice',
        label: 'invoice.created',
        detail: `${invoice.amount} ${invoice.currency} invoice opened with memo ${invoice.memo}`,
      },
      {
        id: 'request',
        label: 'memo.payment_request_built',
        detail: `Call Memo.memo(target=USDC, memoId=${paymentRequest.memoId.slice(0, 12)}...)`,
      },
      {
        id: 'watch',
        label: 'watcher.poll',
        detail: `Watching ${paymentRequest.memoContract} on arc-testnet`,
      },
      {
        id: 'seen',
        label: 'watcher.memo_seen',
        detail: `Matched tx ${DEMO_TX_HASH.slice(0, 12)}... to ${invoice.id}`,
      },
      {
        id: 'receipt',
        label: 'receipt.generated',
        detail: `${receipt.id} stored with payer ${DEMO_PAYER.slice(0, 10)}...`,
      },
      {
        id: 'webhook',
        label: 'webhook.signed',
        detail: `invoice.paid sent with ${signature.header.slice(0, 28)}...`,
      },
    ],
  });
}
