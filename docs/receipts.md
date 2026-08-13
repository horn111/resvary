# Settlary Receipts

> Compatibility module. Settlary's primary product is now prepaid credits and usage billing for AI products. Payment receipts remain supported as funding evidence; see [prepaid-credits.md](prepaid-credits.md) and [arc-credit-funding.md](arc-credit-funding.md).

Settlary Receipts is the payment operations module in Settlary. It gives developers building on Arc a small, typed workflow for invoices, transaction memos, watcher-based payment observation, receipts, signed webhooks, local delivery verification, and replay.

The goal is not to replace x402 or Circle App Kits. The goal is to make the application layer around Arc payments easier to ship. Refund and partial refund state are planned next steps, not shipped behavior in the current module.

## Why this module exists

Accepting a stablecoin transfer is only the first step. Production apps also need to answer:

- Who paid?
- Which invoice or API usage event did the payment belong to?
- Was the payment enough?
- Did it arrive before expiry?
- Which webhook was sent?
- What receipt can the app store, export, or show to a customer?

Arc transaction memos and Unified Balance state patterns make this a natural fit for Arc apps.

## Quick Start

```typescript
import { ReceiptLedger, signWebhookEvent } from '@settlary/sdk/receipts';

const ledger = new ReceiptLedger();

const invoice = ledger.createInvoice({
  id: 'inv_pro_plan_123',
  amount: '19.00',
  currency: 'USDC',
  payTo: '0x1111111111111111111111111111111111111111',
  customerId: 'team_123',
  description: 'Pro plan subscription',
});

console.log(invoice.memo);
// settlary:invoice:v1:inv_pro_plan_123

const receipt = ledger.recordPayment(invoice.id, {
  from: '0x2222222222222222222222222222222222222222',
  to: invoice.payTo,
  amount: '19.00',
  memo: invoice.memo,
  txHash: '0xabc' as `0x${string}`,
});

const paidEvent = ledger.listWebhookEvents().at(-1)!;
const signature = signWebhookEvent(paidEvent, process.env.ARC_WEBHOOK_SECRET!);

console.log(receipt.status);
// paid

console.log(signature.header);
// t=...,v1=...
```

## Arc Testnet Watcher

Use the watcher when you want receipts to come from real Arc Testnet transactions instead of manually calling `recordPayment()`.

```typescript
import { ReceiptWatcher, ReceiptLedger, createMemoPaymentRequest } from '@settlary/sdk/receipts';

const ledger = new ReceiptLedger();

const invoice = ledger.createInvoice({
  id: 'inv_pro_plan_123',
  amount: '19.00',
  payTo: '0x1111111111111111111111111111111111111111',
});

const paymentRequest = createMemoPaymentRequest(invoice);

console.log(paymentRequest.memoContract);
console.log(paymentRequest.target); // Arc Testnet USDC ERC-20 interface
console.log(paymentRequest.memoId); // Indexed memo id for querying logs
console.log(paymentRequest.txData); // Data for Memo.memo(...)

const watcher = new ReceiptWatcher({
  ledger,
  onReceipt(receipt) {
    console.log('paid', receipt.txHash);
  },
});

watcher.watchInvoice(invoice);
watcher.start();
```

The watcher polls Arc Testnet `Memo` events, fetches the transaction receipt, verifies the paired ERC-20 USDC `Transfer`, writes an `onchainProof` onto the receipt, then emits signed-webhook-ready ledger events.

It intentionally watches the ERC-20 USDC interface at `0x3600000000000000000000000000000000000000` and ignores the native USDC system event emitter at `0xfffffffffffffffffffffffffffffffffffffffe` to avoid double-counting the same ERC-20 transfer.

## Arc Testnet Proof

Use `findMemoPaymentProof()` when you want to poll Arc Testnet Memo logs for a matching payment request. Use `verifyMemoPaymentProof()` when you already have a transaction hash and want to prove it matches a generated memo payment request.

```typescript
import {
  createMemoPaymentRequest,
  findMemoPaymentProof,
  verifyMemoPaymentProof,
} from '@settlary/sdk/receipts';

const paymentRequest = createMemoPaymentRequest(invoice);

const watchResult = await findMemoPaymentProof({
  paymentRequest,
});

if (watchResult.status === 'found') {
  console.log(watchResult.proof.explorerUrl);
}

const proof = await verifyMemoPaymentProof({
  txHash: '0x...' as `0x${string}`,
  paymentRequest,
});

console.log(proof.blockNumber);
console.log(proof.memoIndex);
console.log(proof.explorerUrl);
```

The proof path is read-only. It does not send a transaction, store a private key, or replace a production indexer.

## Webhook Inbox and Replay

Use `WebhookInbox` when you want a local app to receive, verify, store, and replay Settlary Receipts webhook deliveries.

```typescript
import { WebhookInbox, serializeWebhookPayload, signWebhookEvent } from '@settlary/sdk/receipts';

const inbox = new WebhookInbox();
const event = ledger.listWebhookEvents().at(-1)!;
const signature = signWebhookEvent(event, process.env.ARC_WEBHOOK_SECRET!);

const delivery = inbox.receive({
  payload: serializeWebhookPayload(event),
  header: signature.header,
  secret: process.env.ARC_WEBHOOK_SECRET!,
  target: 'https://seller.app/webhooks/arc',
});

const replay = inbox.replay({
  event,
  secret: process.env.ARC_WEBHOOK_SECRET!,
  replayOf: delivery.id,
});

console.log(delivery.status); // verified
console.log(replay.attempt); // 2
```

The inbox is intentionally in-memory for local payment-ops workflows. A production app should persist delivery attempts in its own database.

## Persistent Receipts

Use `PersistentReceiptLedger` and `PersistentWebhookInbox` when receipts or delivery attempts need to survive process restart.

```typescript
import {
  InMemoryReceiptStore,
  PersistentReceiptLedger,
  PersistentWebhookInbox,
} from '@settlary/sdk/receipts';

const store = new InMemoryReceiptStore();
const ledger = new PersistentReceiptLedger({ store });
const inbox = new PersistentWebhookInbox({ store });
```

For local SQLite persistence, use the optional `@settlary/sqlite` package:

```typescript
import { PersistentReceiptLedger } from '@settlary/sdk/receipts';
import { createSqliteReceiptStore } from '@settlary/sqlite';

const store = createSqliteReceiptStore({
  path: '.settlary/receipts.sqlite',
});

const ledger = new PersistentReceiptLedger({ store });
```

## What ships in the MVP

- `createInvoice()` for invoice ids, stablecoin minor units, Arc payment URIs, memo ids, and invoice memos.
- `createMemoPaymentRequest()` for Arc `Memo.memo(...)` call data around an ERC-20 USDC transfer.
- `ReceiptWatcher` for polling Arc Testnet memo events and creating receipts from matching payments.
- `findMemoPaymentProof()` for read-only Memo-log polling by memo id.
- `verifyMemoPaymentProof()` for read-only tx/log proof against a memo payment request.
- `createInvoiceMemo()`, `createInvoiceMemoId()`, `createInvoiceMemoData()`, and `parseInvoiceMemo()` for memo correlation.
- `matchPaymentToInvoice()` to validate amount, recipient, currency, network, memo, memo id, and expiry.
- `ReceiptLedger` for an in-memory invoice/receipt/event store with duplicate tx protection.
- `PersistentReceiptLedger`, `InMemoryReceiptStore`, and optional SQLite storage for restart-safe receipts.
- `signWebhookEvent()` and `verifyWebhookSignature()` for HMAC-signed webhooks.
- `WebhookInbox` for local signed-webhook verification, delivery attempts, and replay.
- `PersistentWebhookInbox` for store-backed signed-webhook verification, delivery attempts, and replay.

## Current Limits

The watcher is intentionally local-first and polling-based. Proof mode is read-only. Watcher cursors can now be persisted through a receipt store, but the module does not yet run a hosted indexer, use Circle event monitors, or watch Gateway settlement.

## Planned Next Steps

- Postgres receipt store.
- Import/export for local demo data.
- Refund receipts and partial refund accounting.
- Unified Balance readiness states.
- Demo dashboard for invoice state transitions.
