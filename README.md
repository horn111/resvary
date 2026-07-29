<p align="center">
  <img src="assets/brand/settlary-x-avatar.png" alt="Settlary logo" width="128" />
  <br />
  <img src="https://img.shields.io/badge/Built_on-Arc_Testnet-7c3aed?style=for-the-badge" alt="Built on Arc Testnet" />
  <img src="https://img.shields.io/badge/USDC-Powered-2775ca?style=for-the-badge&logo=circle&logoColor=white" alt="USDC Powered" />
  <img src="https://img.shields.io/badge/x402-Compatible-000000?style=for-the-badge" alt="x402 Compatible" />
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge" alt="License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.6+-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<h1 align="center">Settlary</h1>

<p align="center">
  <strong>Open-source payment operations for stablecoin apps, built on Arc.</strong>
  <br />
  Paid APIs, invoices, transaction memos, persistent receipts, watcher proof polling, signed webhooks, and local delivery replay.
</p>

<p align="center">
  <a href="#why-this-exists">Why</a> ·
  <a href="#what-works-today">What Works</a> ·
  <a href="#settlary-receipts">Settlary Receipts</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="docs/grant.md">Grant Snapshot</a> ·
  <a href="docs/demo-script.md">Demo Script</a> ·
  <a href="docs/receipts.md">Receipts Docs</a> ·
  <a href="ROADMAP.md">Roadmap</a>
</p>

---

## Why This Exists

Arc is built for stablecoin-native financial applications: predictable USDC-denominated fees, fast deterministic settlement, and direct access to Circle's developer stack.

That creates a strong base layer, but application developers still need the operational layer around payments:

- pricing and paid API gates
- invoice IDs
- transaction memos
- receipt generation
- webhook signing
- webhook verification
- replayable delivery attempts
- local reconciliation during development

Settlary is focused on that application layer. The name reflects the settlement layer it provides between onchain payments and application operations. The current product direction is intentionally narrow: make payments built on Arc operable for developers building APIs, agents, and stablecoin-native apps.

## Grant Snapshot

Settlary is a TypeScript monorepo with:

- `@settlary/sdk` for middleware, buyer flows, billing, receipts, watcher logic, and webhook delivery helpers.
- `create-settlary` for scaffolding a paid API project from this repo.
- `apps/demo` for a local Next.js demo of paywalled endpoints and Settlary Receipts payment ops.
- Documentation for the grant snapshot, local demo script, getting started, architecture, Arc rationale, and the receipts module.

The newest shipped path is:

```text
create invoice
build Arc transaction memo payment request
watch Arc Testnet memo-wrapped USDC payment
generate receipt
optionally auto-watch or verify a real Arc Testnet tx proof
create signed invoice.paid webhook
deliver webhook into local inbox
verify SDK signature
replay webhook with a fresh timestamp
```

This is not a hosted dashboard or production queue yet. It is a developer-facing local payment ops kit that proves the core workflow end to end.

## What Works Today

| Area | Status | Notes |
|------|--------|-------|
| Express paywall middleware | Ready | Returns x402-style `402 Payment Required` responses and validates payment payloads. |
| Next.js Route Handler adapter | Ready | Wraps App Router route handlers with the same paywall flow. |
| Buyer SDK | Ready | Handles `402 -> sign -> retry` for EIP-3009-style payments. |
| Billing engine | Ready | Per-request, per-second, and per-job pricing helpers. |
| Usage metering | Ready | In-memory usage records and summaries. |
| CLI scaffolder | Ready in repo | `packages/create-settlary` generates Express or Next.js paid API starters. |
| Settlary Receipts | Ready | Invoices, memos, receipts, signed webhook events, in-memory ledger, and persistent ledger APIs. |
| Arc Testnet watcher | Ready | Watches memo-wrapped USDC payments and records matching receipts locally. |
| Arc Testnet proof mode | Ready | Polls Memo logs or verifies a pasted tx hash against a memo payment request and returns block/log proof. |
| Webhook Inbox + Replay | Ready | Verifies signed webhook delivery attempts and replays events locally. |
| SQLite receipt store | Ready | Optional `@settlary/sqlite` package for local invoices, receipts, webhook deliveries, and watcher cursors. |
| Demo app | Ready locally | Next.js demo with paid endpoints, watcher flow, onchain proof, inbox verification, and replay. |
| Postgres receipt store | Planned | Postgres adapter is deferred until after SQLite/local persistence. |
| Hosted dashboard | Planned | Analytics UI and managed ops surface are not part of the current MVP. |
| Fastify/Hono/Python/Go adapters | Planned | Current framework adapters are Express and Next.js. |

## Settlary Receipts

Settlary Receipts is the main module in the current roadmap. It turns raw stablecoin payments into app-level payment operations.

### The Problem

A transfer is not enough for most apps. Builders need to know:

- Which invoice was paid?
- Which transaction memo connected the payment to app state?
- Was the payment amount sufficient?
- Which receipt should be stored?
- Which webhook was sent?
- Did the app verify the signature?
- Can the webhook delivery be replayed during development?

### The Local Flow

```mermaid
sequenceDiagram
    participant App as Developer App
    participant SDK as Settlary SDK
    participant Arc as Arc Testnet
    participant Inbox as Webhook Inbox

    App->>SDK: create invoice
    SDK->>App: invoice memo + payment request
    App->>Arc: send USDC with memo
    SDK->>Arc: watcher polls Memo events
    Arc-->>SDK: matching memo + transfer
    SDK->>Arc: verify tx receipt proof
    SDK->>SDK: generate receipt
    SDK->>SDK: sign invoice.paid webhook
    SDK->>Inbox: deliver signed payload
    Inbox->>Inbox: verify signature
    App->>Inbox: replay webhook
    Inbox->>Inbox: new delivery attempt + fresh timestamp
```

### What This Proves

The demo does not stop at "webhook ready". It shows verified delivery:

- `receipt.generated`
- optional `onchainProof` with tx hash, block, memo/log index, and Arcscan link
- raw webhook payload
- `x-settlary-signature`
- SDK verification
- delivery attempt `#1`
- replayed delivery attempt `#2`
- new `t=<timestamp>,v1=<hmac>` signature header

## Quickstart

### Install

```bash
npm install @settlary/sdk
```

### Express Paid Endpoint

```typescript
import express from 'express';
import { expressPaywall } from '@settlary/sdk/middleware';

const app = express();

app.get(
  '/api/premium/data',
  expressPaywall({
    price: '0.001',
    network: 'arc-testnet',
    payTo: '0x1111111111111111111111111111111111111111',
  }),
  (_req, res) => {
    res.json({ data: 'This costs 0.001 USDC per request' });
  },
);

app.listen(3000);
```

### Next.js Route Handler

```typescript
import { nextPaywall } from '@settlary/sdk/middleware';

export const GET = nextPaywall(
  {
    price: '0.001',
    network: 'arc-testnet',
    payTo: '0x1111111111111111111111111111111111111111',
  },
  async () => {
    return Response.json({ data: 'Premium content' });
  },
);
```

### Buyer Client

```typescript
import { BuyerClient } from '@settlary/sdk/client';

const buyer = new BuyerClient({
  privateKey: process.env.BUYER_PRIVATE_KEY as `0x${string}`,
  rpcUrl: 'https://rpc.testnet.arc.network',
});

const response = await buyer.request('https://api.example.com/api/premium/data');

console.log(response.data);
console.log(response.payment);
```

### Invoice, Receipt, and Signed Webhook

```typescript
import {
  ReceiptLedger,
  signWebhookEvent,
} from '@settlary/sdk/receipts';

const ledger = new ReceiptLedger();

const invoice = ledger.createInvoice({
  id: 'inv_pro_plan_123',
  amount: '19.00',
  currency: 'USDC',
  payTo: '0x1111111111111111111111111111111111111111',
  description: 'Pro plan subscription',
});

const receipt = ledger.recordPayment(invoice.id, {
  from: '0x2222222222222222222222222222222222222222',
  to: invoice.payTo,
  amount: '19.00',
  memo: invoice.memo,
  txHash: '0xabc' as `0x${string}`,
});

const paidEvent = ledger.listWebhookEvents().at(-1)!;
const signature = signWebhookEvent(paidEvent, process.env.ARC_WEBHOOK_SECRET!);

console.log(invoice.memo);      // settlary:invoice:v1:inv_pro_plan_123
console.log(receipt.status);    // paid
console.log(signature.header);  // t=...,v1=...
```

### Webhook Inbox + Replay

```typescript
import {
  WebhookInbox,
  serializeWebhookPayload,
  signWebhookEvent,
} from '@settlary/sdk/receipts';

const inbox = new WebhookInbox();
const event = ledger.listWebhookEvents().at(-1)!;
const signed = signWebhookEvent(event, process.env.ARC_WEBHOOK_SECRET!);

const delivery = inbox.receive({
  payload: serializeWebhookPayload(event),
  header: signed.header,
  secret: process.env.ARC_WEBHOOK_SECRET!,
  target: 'https://seller.app/webhooks/arc',
});

const replay = inbox.replay({
  event,
  secret: process.env.ARC_WEBHOOK_SECRET!,
  replayOf: delivery.id,
});

console.log(delivery.status); // verified
console.log(replay.attempt);  // 2
```

### Persistent Receipts With SQLite

```typescript
import { PersistentReceiptLedger } from '@settlary/sdk/receipts';
import { createSqliteReceiptStore } from '@settlary/sqlite';

const store = createSqliteReceiptStore({
  path: '.settlary/receipts.sqlite',
});

const ledger = new PersistentReceiptLedger({ store });

const invoice = await ledger.createInvoice({
  id: 'inv_persistent_123',
  amount: '19.00',
  payTo: '0x1111111111111111111111111111111111111111',
});

console.log(invoice.id);
```

## Running The Demo

```bash
git clone https://github.com/horn111/settlary.git
cd settlary
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The demo includes:

- paywalled API endpoint probes
- invoice and memo payment data
- Arc Testnet watcher flow simulation/API
- generated receipt JSON
- signed webhook payload
- local Webhook Inbox verification
- replayed webhook delivery attempt

## CLI Scaffolder

The repo includes a scaffolder package:

```bash
npm run build --workspace=packages/create-settlary
node packages/create-settlary/dist/index.js my-paid-api
```

It can generate Express or Next.js starters with a paid API route and environment template.

## SDK Modules

### Middleware

```typescript
import {
  createPaywallMiddleware,
  expressPaywall,
  nextPaywall,
} from '@settlary/sdk/middleware';
```

The default verifier checks payment payload structure, amount, recipient, and expiry. Production integrations can provide a custom `verifyPayment` function to delegate verification to the appropriate payment infrastructure.

### Client

```typescript
import { BuyerClient } from '@settlary/sdk/client';
```

The buyer client signs an authorization and retries the original request with an `x-payment` header after receiving a `402 Payment Required` response.

### Billing

```typescript
import { UsageMeter, createBillingPlan } from '@settlary/sdk/billing';
```

Billing helpers support:

- per-request pricing
- per-second pricing
- per-job pricing
- in-memory usage summaries

### Gateway / Balance Helpers

```typescript
import { GatewayClient } from '@settlary/sdk/gateway';
```

The current Gateway client is intentionally small: it checks Arc Testnet native USDC balance, formats explorer links, and provides sufficient-balance checks. Deposit tracking, pending settlement state, and alerts are planned.

### Receipts

```typescript
import {
  ReceiptWatcher,
  InMemoryReceiptStore,
  PersistentReceiptLedger,
  PersistentWebhookInbox,
  ReceiptLedger,
  WebhookInbox,
  createWebhookRouteHandler,
  createInvoiceMemo,
  createMemoPaymentRequest,
  signWebhookEvent,
  verifyMemoPaymentProof,
  verifyWebhookSignature,
} from '@settlary/sdk/receipts';
```

Receipts are the strongest current module and the center of near-term development. The core SDK now exposes store interfaces and persistent ledger/inbox helpers; local SQLite persistence lives in the optional `@settlary/sqlite` package.

## Project Structure

```text
settlary/
|-- apps/
|   `-- demo/
|       |-- src/app/page.tsx
|       `-- src/app/api/
|           |-- joke/
|           |-- weather/
|           |-- receipts/
|           `-- webhook-inbox/
|-- packages/
|   |-- sdk/
|   |   `-- src/
|   |       |-- billing/
|   |       |-- client/
|   |       |-- gateway/
|   |       |-- middleware/
|   |       `-- receipts/
|   |-- sqlite/
|   |   `-- src/
|   `-- create-settlary/
|       `-- src/
|-- docs/
|   |-- architecture.md
|   |-- demo-script.md
|   |-- grant.md
|   |-- getting-started.md
|   |-- persistence.md
|   |-- receipts.md
|   `-- why-arc.md
|-- ROADMAP.md
`-- CHANGELOG.md
```

## Why Arc

Arc is a stablecoin-native Layer 1 from Circle, currently live on public testnet. It is designed around real-world financial flows: predictable dollar-based transaction costs, deterministic finality, and integration with Circle infrastructure such as USDC, CCTP, and Gateway.

That makes Arc a natural environment for:

- paid APIs
- autonomous agent payments
- usage-based billing
- stablecoin receipts
- application-level reconciliation
- payment operations that need fast settlement and predictable costs

Settlary focuses on the developer tooling around those workflows.

## Current Limits

This repo is still early. The current implementation is useful for local development, demos, and SDK iteration, but several production pieces are intentionally not finished yet:

- SQLite local persistence is available; Postgres is planned
- no hosted persistent database
- no hosted dashboard
- no managed webhook queue
- no Fastify/Hono/Python/Go adapters yet
- no default production Gateway verification path without a custom verifier
- refund and partial refund accounting are planned, not shipped

## Roadmap

### Shipped

- Express and Next.js paywall middleware
- Buyer SDK
- billing plans and usage metering
- invoice and transaction memo helpers
- Arc Testnet receipt watcher
- signed webhook helpers
- local Webhook Inbox + Replay
- persistent receipt store interfaces
- optional SQLite receipt store
- persistent watcher cursors
- signed webhook route helper
- local Next.js demo
- repo-local CLI scaffolder

### Next

- Postgres receipt store
- import/export for local demo data
- refund and partial refund states
- stronger Gateway readiness helpers
- cleaner hosted demo flow

### Later

- dashboard and analytics
- Fastify and Hono adapters
- Python and Go SDKs
- hosted payment ops surface
- agent commerce workflows

## Development

```bash
npm install
npm run typecheck
npm run test --workspaces --if-present -- --reporter=dot
npm run dev
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

For security concerns, see [SECURITY.md](SECURITY.md). Do not report security vulnerabilities through public GitHub issues.

## License

Apache-2.0. See [LICENSE](LICENSE).

---

<p align="center">
  <strong>Settlary · Payment operations for stablecoin apps · Built on <a href="https://www.arc.io">Arc</a></strong>
</p>

<p align="center">
  <sub>
    Settlary is an independent open-source project and is not affiliated with or endorsed by Circle Internet Financial.
    <br />
    Circle, USDC, and Arc are trademarks of Circle Internet Financial, LLC.
  </sub>
</p>
