# @settlary/sdk

Core SDK package for `settlary`.

It includes paid API middleware, buyer SDK helpers, billing helpers, Settlary Receipts, persistent receipt store interfaces, watcher logic, read-only Arc Testnet proof polling and verification, signed webhooks, and local webhook inbox replay for Arc payment workflows.

## Installation

```bash
npm install @settlary/sdk
```

## Seller: Paywall An API

```typescript
import express from 'express';
import { expressPaywall } from '@settlary/sdk/middleware';

const app = express();

app.get(
  '/api/data',
  expressPaywall({
    price: '0.001',
    network: 'arc-testnet',
    payTo: '0x1111111111111111111111111111111111111111',
  }),
  (_req, res) => {
    res.json({ data: 'premium content' });
  },
);
```

The default verifier checks payment payload structure, amount, recipient, and expiry. Production apps can provide a custom `verifyPayment` function.

## Buyer: Pay For API Access

```typescript
import { BuyerClient } from '@settlary/sdk/client';

const buyer = new BuyerClient({
  privateKey: '0x...',
  rpcUrl: 'https://rpc.testnet.arc.network',
});

const response = await buyer.request('https://api.example.com/data');
console.log(response.data);
```

## Payment Ops: Receipt And Webhook Replay

```typescript
import {
  ReceiptLedger,
  WebhookInbox,
  InMemoryReceiptStore,
  PersistentReceiptLedger,
  PersistentWebhookInbox,
  createMemoPaymentRequest,
  findMemoPaymentProof,
  serializeWebhookPayload,
  signWebhookEvent,
  verifyMemoPaymentProof,
} from '@settlary/sdk/receipts';

const store = new InMemoryReceiptStore();
const ledger = new PersistentReceiptLedger({ store });

const invoice = await ledger.createInvoice({
  id: 'inv_123',
  amount: '19.00',
  payTo: '0x1111111111111111111111111111111111111111',
});

const receipt = await ledger.recordPayment(invoice.id, {
  from: '0x2222222222222222222222222222222222222222',
  to: invoice.payTo,
  amount: '19.00',
  memo: invoice.memo,
  txHash: '0xabc' as `0x${string}`,
});

const paymentRequest = createMemoPaymentRequest(invoice);
const watchResult = await findMemoPaymentProof({ paymentRequest });
const proof = await verifyMemoPaymentProof({
  txHash: '0x...' as `0x${string}`,
  paymentRequest,
});

const event = (await ledger.listWebhookEvents()).at(-1)!;
const signed = signWebhookEvent(event, 'secret');

const inbox = new PersistentWebhookInbox({ store });
const delivery = await inbox.receive({
  payload: serializeWebhookPayload(event),
  header: signed.header,
  secret: 'secret',
});

const replay = await inbox.replay({
  event,
  secret: 'secret',
  replayOf: delivery.id,
});

console.log(receipt.status);   // paid
console.log(watchResult.status);
console.log(proof.explorerUrl);
console.log(delivery.status);  // verified
console.log(replay.attempt);   // 2
```

## Modules

| Module | Import | Description |
|--------|--------|-------------|
| Middleware | `@settlary/sdk/middleware` | Express and Next.js paywall middleware |
| Client | `@settlary/sdk/client` | Buyer SDK for `402 -> sign -> retry` flows |
| Billing | `@settlary/sdk/billing` | Usage metering and billing plans |
| Gateway | `@settlary/sdk/gateway` | Small Arc Testnet balance helper |
| Receipts | `@settlary/sdk/receipts` | Invoices, memos, stores, watcher, onchain proof polling, receipts, signed webhooks, inbox replay |

## Current Limits

- Core SDK includes store interfaces and in-memory persistence helpers.
- SQLite is available through optional `@settlary/sqlite`.
- Onchain proof mode is read-only and does not send transactions.
- Auto proof polling is local and does not replace a hosted indexer or persistent cursor.
- Postgres storage is planned, not shipped.
- Gateway helpers do not yet include deposit tracking or pending settlement state.

## Docs

- [Root README](../../README.md)
- [Grant Snapshot](../../docs/grant.md)
- [Demo Script](../../docs/demo-script.md)
- [Onchain Proof](../../docs/onchain-proof.md)
- [Settlary Receipts](../../docs/receipts.md)
- [Persistence](../../docs/persistence.md)

## License

Apache-2.0. See [LICENSE](../../LICENSE).
