# Architecture

Settlary is a local-first payment operations toolkit for stablecoin apps, built on Arc. It sits between an application and payment infrastructure, giving developers reusable SDK pieces for paid APIs, billing, receipts, watchers, and signed webhook delivery.

## Current System Shape

```text
Developer app
  |
  |-- Express / Next.js API routes
  |     |
  |     |-- @settlary/sdk/middleware
  |     |     - 402 Payment Required responses
  |     |     - payment header parsing
  |     |     - default structural verification
  |     |     - optional app-provided verifier
  |     |
  |     |-- @settlary/sdk/billing
  |     |     - per-request pricing
  |     |     - per-second pricing
  |     |     - per-job pricing
  |     |     - in-memory usage records
  |     |
  |     |-- @settlary/sdk/receipts
  |           - invoices
  |           - transaction memos
  |           - receipt matching
  |           - persistent receipt store interfaces
  |           - Arc Testnet watcher
  |           - read-only Arc Testnet proof polling
  |           - signed webhook events
  |           - local webhook inbox
  |           - replayable delivery attempts
  |
  |-- @settlary/sdk/client
        - buyer-side 402 -> sign -> retry flow
```

## Payment Ops Flow

```mermaid
sequenceDiagram
    participant Buyer as Buyer / Agent
    participant API as Seller API
    participant SDK as Settlary SDK
    participant Arc as Arc Testnet
    participant Inbox as Webhook Inbox

    Buyer->>API: GET paid endpoint
    API->>SDK: paywall middleware
    SDK-->>Buyer: 402 + payment requirements
    Buyer->>Buyer: sign authorization
    Buyer->>API: retry with x-payment
    API->>SDK: verify payment payload
    SDK-->>API: allow handler
    API-->>Buyer: paid response

    API->>SDK: create invoice
    SDK-->>API: memo payment request
    Buyer->>Arc: send USDC with memo
    SDK->>Arc: watcher polls memo events
    Arc-->>SDK: matching memo + transfer
    SDK->>Arc: watch or verify tx receipt proof
    SDK->>SDK: generate receipt
    SDK->>SDK: sign invoice.paid webhook
    SDK->>Inbox: deliver signed payload
    Inbox->>Inbox: verify signature
    API->>Inbox: replay webhook
```

## Module Responsibilities

### Middleware

Current adapters:

- `expressPaywall()`
- `nextPaywall()`
- `createPaywallMiddleware()`

The default middleware verifier is intentionally small. It validates payment payload shape, amount, recipient, and expiry. Production apps can pass a custom `verifyPayment` function to delegate verification to their own payment infrastructure.

### Buyer Client

`BuyerClient` handles the client-side flow:

```text
request endpoint
-> receive 402 requirements
-> sign payment authorization
-> retry with x-payment header
-> return response and payment metadata
```

### Billing

Billing helpers model local pricing and usage state:

- per-request pricing;
- per-second pricing;
- per-job pricing;
- in-memory usage metering.

Persistent usage storage is planned, not shipped.

### Receipts

Receipts are the strongest current module. They cover:

- invoice creation;
- memo construction;
- memo payment request data;
- matching observed payments to invoices;
- read-only Arc Testnet proof polling and tx proof;
- local receipt generation;
- persistent receipt store interfaces;
- signed webhook events;
- local webhook inbox verification;
- replayable delivery attempts.

### Watcher

`ReceiptWatcher` is local-first and polling-based. It watches Arc Testnet memo-wrapped USDC payment shape, matches observed payments to invoices, attaches onchain proof data, and records receipts in the local ledger. `findMemoPaymentProof()` exposes the same read-only Memo-log lookup for a single payment request when a demo or app wants proof to fill in automatically.

Current limits:

- SQLite local persistence is available through the optional `@settlary/sqlite` package;
- no hosted indexer;
- no hosted database-backed receipt store;
- no transaction broadcasting in proof mode;
- no refund state in the current watcher flow.

### Gateway / Balance Helpers

`GatewayClient` is currently a small balance helper. It can read Arc Testnet native USDC balance, format explorer links, and check sufficient balance.

It does not yet provide deposit tracking, pending settlement state, withdrawal automation, or alerting.

## Demo Architecture

The local Next.js demo contains:

- `/api/joke` and `/api/weather` paywalled endpoint probes;
- `/api/receipts` for the receipt and watcher demo payload;
- `/api/receipts/proof` for read-only Arc Testnet tx proof verification;
- `/api/receipts/proof/watch` for read-only Arc Testnet Memo-log proof polling;
- `/api/webhook-inbox` for raw signed webhook delivery verification;
- `/api/webhook-inbox/replay` for replaying the same webhook event with a fresh signature timestamp;
- `page.tsx` for the interactive local payment ops walkthrough.

The demo is designed to prove the developer workflow locally. It is not a production dashboard.

## Planned Extensions

The next architecture step after SQLite persistence is production storage breadth:

```text
SQLite local receipt store
-> Postgres receipt store
-> Next.js webhook route helper
-> refund and partial refund states
```

Later extensions may include dashboard analytics, additional framework adapters, and hosted payment operations surfaces.
