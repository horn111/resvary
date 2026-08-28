# Direct Arc Credit Funding

Direct Arc Testnet USDC is one of Resvary's two Circle-native funding rails. It is first-class alongside Circle Gateway Nanopayments. Both fund the same payment-rail-agnostic prepaid credit ledger.

```typescript
import { CreditLedger } from '@resvary/sdk/credits';
import { ArcCreditFunding } from '@resvary/sdk/funding/arc';

const ledger = new CreditLedger({ projectId: 'my_ai_product' });
const funding = new ArcCreditFunding({
  ledger,
  payTo: '0x1111111111111111111111111111111111111111',
  receiptStore,
});

const request = await funding.createFundingRequest({
  customerId: 'customer_123',
  amount: '25',
  idempotencyKey: 'topup_123',
});
```

The request contains a funding intent, payment invoice, and Memo-wrapped transfer request. Confirm only a verified receipt:

```typescript
await funding.confirmPayment({
  fundingIntentId: request.fundingIntent.id,
  receipt: paymentReceipt,
  idempotencyKey: `arc:${paymentReceipt.txHash}`,
});
```

Confirmation checks invoice, network, recipient, actual amount, and transaction hash. The proof layer additionally checks Arc chain ID, Memo contract, Memo ID, calldata hash, USDC transfer, sender, transaction status, and confirmation depth.

- Underpayment fails.
- A verified overpayment credits the actual amount.
- One `rail + network + externalPaymentId` can fund only one intent.
- Payment receipts and usage receipts remain separate records.

## Durable worker

```typescript
import { ArcFundingWorker } from '@resvary/sdk/funding';

const worker = new ArcFundingWorker({
  ledger,
  receiptStore,
  payTo,
  confirmations: 2,
  maxBlockRange: 2_000,
  maxBlocksPerPoll: 10_000,
  cursorOverlap: 2,
});

worker.start();
```

The worker restores pending invoices after restart, persists cursors, bounds RPC ranges, retries transient failures, rescans a small overlap, and reconciles a receipt saved before a crash with a missing credit grant.

This is Arc Testnet functionality. Resvary does not export a mainnet placeholder or claim production settlement, custody, or redemption.

## Release proof runner

For the `0.4.0-alpha.0` evidence run, copy `.env.example` to `.env.local`, fund a disposable Arc
Testnet buyer, and set `RESVARY_ARC_BUYER_PRIVATE_KEY` plus
`RESVARY_ARC_FUNDING_RECIPIENT`. Run `npm run proof:arc`.

The runner persists the funding intent and invoice, restarts the worker before payment, sends the
Memo-wrapped USDC transaction, scans it after the configured confirmation depth, persists the
watcher cursor, replays the same receipt, and runs one reserve/commit usage lifecycle. It writes
`docs/evidence/arc-testnet-proof.json`; the private key is never written to evidence or logs.
