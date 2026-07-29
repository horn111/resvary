# @settlary/demo

Local Next.js demo for `settlary` payment operations on Arc.

The demo shows more than paywalled endpoints. It walks through the current Settlary Receipts flow:

```text
invoice
-> transaction memo payment request
-> watcher flow
-> generated receipt
-> optional Arc Testnet proof polling or tx proof
-> signed webhook
-> local inbox verification
-> replayed delivery attempt
```

## Quick Start

```bash
# From the repo root
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What To Click

1. Click `Run Watcher Flow`.
2. Inspect `Memo Payment Data`.
3. Inspect `Generated Receipt`.
4. Inspect `Onchain Proof`.
5. Optionally click `Watch Arc Testnet`, or paste a real Arc Testnet Memo transaction hash and verify it.
6. Inspect `Webhook Inbox`.
7. Confirm `Received`, `Verified`, and `Signature OK`.
8. Click `Replay Webhook`.
9. Confirm `Delivery attempt #2` appears with a fresh signature timestamp.

## Demo Routes

| Route | Purpose |
|-------|---------|
| `GET /api/joke` | Paywalled joke endpoint probe |
| `GET /api/weather?city=NYC` | Paywalled weather endpoint probe |
| `GET /api/receipts` | Generates the local receipt/watcher demo payload |
| `POST /api/receipts/proof` | Verifies a pasted Arc Testnet tx hash against the memo payment request |
| `POST /api/receipts/proof/watch` | Polls Arc Testnet Memo logs for the generated memo payment request |
| `POST /api/webhook-inbox` | Receives raw signed webhook payload and verifies it |
| `POST /api/webhook-inbox/replay` | Replays a webhook event with a fresh signature timestamp |

## Reviewer Script

See [../../docs/demo-script.md](../../docs/demo-script.md) for the full grant-review walkthrough and API fallback checks.

## Current Limits

- The default hosted/demo inbox is in-memory.
- The default hosted/demo receipt ledger is in-memory.
- Local SQLite persistence is available with `SETTLARY_RECEIPTS_STORE=sqlite`.
- Onchain proof mode is read-only and never asks for a private key.
- Auto proof polling is local and does not replace a hosted indexer.
- The watcher flow is a local developer demo.
- Hosted dashboard and persistent storage are planned, not shipped.

## License

Apache-2.0
