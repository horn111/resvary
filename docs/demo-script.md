# Demo Script

This script is for reviewers who want to verify the current `settlary` payment ops flow locally.

The demo is local-first. It does not require a hosted dashboard, database, or production webhook queue.

## Setup

```bash
git clone https://github.com/horn111/settlary.git
cd settlary
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## UI Walkthrough

1. Open the demo home page.
2. Click `Run Watcher Flow`.
3. Confirm the flow advances through:
   - `Invoice Created`
   - `Memo Payment`
   - `Watcher Poll`
   - `Receipt Generated`
4. Inspect `Memo Payment Data`.
   - Expected fields: invoice id, amount, memo contract, memo id, call data hash.
5. Inspect `Generated Receipt`.
   - Expected proof: paid receipt JSON with tx hash, payer, and invoice memo.
6. Inspect `Onchain Proof`.
   - Expected status before a live tx: pending.
   - Expected fields: transaction hash input, `Watch Arc Testnet`, chain id, block, memo index, log index, and proof JSON.
7. Inspect `Webhook Inbox`.
   - Expected status: `Received` is `yes`.
   - Expected status: `Verified` is `yes`.
   - Expected status: `Signature` is `OK`.
   - Expected event: `Delivery attempt #1`.
8. Click `Replay Webhook`.
9. Confirm the inbox now shows:
   - `Attempts` is `2`;
   - `Delivery attempt #2`;
   - `Signature OK`;
   - a fresh `t=<timestamp>` in the signature header.

## Optional Arc Testnet Proof

This step is optional and read-only from the demo. The demo never asks for a private key and never broadcasts a transaction.

1. Run the local demo.
2. Click `Run Watcher Flow`.
3. Inspect `Memo Payment Data`.
4. From your own funded Arc Testnet EOA, send USDC through the Arc Memo contract using the generated:
   - memo contract;
   - target;
   - memo id;
   - memo data;
   - tx data.
5. Click `Watch Arc Testnet`.
6. Wait for the matching Memo event to be found.
7. If you already have the hash, paste it into `Onchain Proof` and click `Verify Arc Testnet Tx` instead.

Expected proof points:

- `Chain ID` is `5042002`;
- `Block` is populated;
- `Memo Index` is populated;
- `Log Index` is populated;
- `View on Arcscan` opens the verified transaction;
- proof JSON includes `txHash`, `memoId`, `callDataHash`, `payer`, `payTo`, and `explorerUrl`.

## What The Demo Proves

The shipped flow is:

```text
create invoice
build memo payment request
watch Arc Testnet payment shape
generate receipt
optionally auto-watch or verify a real Arc Testnet tx proof
sign invoice.paid webhook
deliver signed payload
verify signature locally
store delivery attempt
replay webhook with fresh timestamp
```

The important proof is not only that a receipt object exists. The demo proves verified webhook delivery and replay, which is the operational layer apps need after payment.

The optional onchain proof path connects the same receipt shape to a concrete Arc Testnet transaction, block, Memo event, and Arcscan link. Reviewers can use automatic Memo-log polling or paste a known tx hash.

The demo reports the active receipt store mode. By default it uses an in-memory store. For local SQLite persistence, run:

```bash
SETTLARY_RECEIPTS_STORE=sqlite npm run dev
```

## API Fallback Check

If the browser UI is unavailable, run the flow through local API routes after `npm run dev`.

```bash
curl http://localhost:3000/api/receipts
```

For the full inbox and replay check, use Node so the raw JSON body and signature header are preserved:

```bash
node - <<'NODE'
const base = 'http://localhost:3000';

const receiptResponse = await fetch(`${base}/api/receipts`);
const receiptData = await receiptResponse.json();

const rawPayload = JSON.stringify(receiptData.webhook.event);

const inboxResponse = await fetch(`${base}/api/webhook-inbox`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-settlary-signature': receiptData.webhook.signatureHeader,
  },
  body: rawPayload,
});
const inboxData = await inboxResponse.json();

const replayResponse = await fetch(`${base}/api/webhook-inbox/replay`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    event: receiptData.webhook.event,
    replayOf: inboxData.delivery.id,
  }),
});
const replayData = await replayResponse.json();

console.log({
  receipt: receiptData.receipt.id,
  firstAttempt: inboxData.delivery.attempt,
  firstStatus: inboxData.delivery.status,
  replayAttempt: replayData.delivery.attempt,
  replayStatus: replayData.delivery.status,
  replayOf: replayData.delivery.replayOf,
});
NODE
```

Expected output:

```text
firstAttempt: 1
firstStatus: verified
replayAttempt: 2
replayStatus: verified
replayOf: <first delivery id>
```

## Notes For Grant Reviewers

- The default hosted/demo inbox is in-memory unless `SETTLARY_RECEIPTS_STORE=sqlite` is set locally.
- Onchain proof mode is read-only and does not send transactions.
- Auto proof polling is local and read-only; it is not a hosted indexer.
- SQLite persistence, watcher cursors, and webhook route helpers are available locally; Postgres and refund states are planned next.
- The current demo is designed to prove the local developer workflow, not to replace a production payment processor or hosted dashboard.
