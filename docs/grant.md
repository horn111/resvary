# Grant Application Snapshot

## Project

Settlary is an open-source TypeScript payment operations toolkit for stablecoin apps, built on Arc.

It helps developers move beyond "a payment happened" and into application-level payment operations: invoices, transaction memos, receipts, signed webhooks, verified delivery attempts, and local replay.

## One-Liner

Open-source TypeScript kit for operable stablecoin payments on Arc: invoices, memo payment proofs, receipts, signed webhooks, replay, and local persistence.

## Problem

Arc gives builders a stablecoin-native execution environment, but application teams still need the operational layer around payments.

For a real app, a USDC transfer is only the start. The app also needs to know:

- which invoice or API usage event was paid;
- which transaction memo connected the payment to app state;
- whether the amount and recipient matched expectations;
- which receipt should be stored;
- which webhook was sent;
- whether the receiving app verified the signature;
- whether a webhook delivery can be replayed during development or debugging.

Without this layer, builders can accept payments but still have to hand-roll the payment operations code that makes those payments useful inside products.

## What Is Built

The current repo includes:

- `@settlary/sdk` for middleware, buyer flows, billing, receipts, watcher logic, and webhook delivery helpers.
- Express and Next.js paywall adapters for x402-style `402 Payment Required` flows.
- `BuyerClient` for the `402 -> sign -> retry` client flow.
- Billing helpers for per-request, per-second, and per-job pricing.
- `ReceiptLedger` for backwards-compatible in-memory invoices, receipts, and webhook events.
- `ReceiptStore`, `InMemoryReceiptStore`, and `PersistentReceiptLedger` for restart-safe receipt workflows.
- Optional `@settlary/sqlite` local/dev store for invoices, receipts, webhook deliveries, webhook events, and watcher cursors.
- `ReceiptWatcher` for memo-wrapped Arc Testnet USDC payments.
- Store-backed watcher cursors so local scans can resume from saved block state.
- `findMemoPaymentProof` and `verifyMemoPaymentProof` for read-only Arc Testnet Memo-log polling or tx/log proof against a memo payment request.
- `WebhookInbox` and `PersistentWebhookInbox` for signed webhook verification, delivery recording, and replay.
- A framework-light webhook route helper for raw body handling, `x-settlary-signature` verification, and typed success/failure responses.
- `create-settlary` scaffolder for Express or Next.js paid API starters.
- A hosted/local Next.js demo that shows the payment ops flow end to end.

## Proven Proof Flow

The current proof path is:

```text
create invoice
build Arc transaction memo payment request
watch Arc Testnet memo-wrapped USDC payment
generate receipt
optionally auto-watch or verify the receipt against a real Arc Testnet tx
create signed invoice.paid webhook
deliver webhook into local inbox
verify SDK signature
replay webhook with a fresh timestamp
```

The demo proves the chain does not stop at "webhook ready". It shows verified delivery attempts:

- `receipt.generated`
- optional `onchainProof` with tx hash, block, memo index, log index, and Arcscan link
- raw webhook payload
- `x-settlary-signature`
- `Signature OK`
- `Delivery attempt #1`
- `Replay Webhook`
- `Delivery attempt #2`
- fresh `t=<timestamp>,v1=<hmac>` signature header

## Why This Matters For Arc/Circle

Arc is a natural environment for paid APIs, autonomous agents, usage-based billing, and stablecoin-native apps. Those apps need more than raw payment primitives: they need payment operations that developers can run, test, inspect, and eventually persist.

Settlary focuses on the developer infrastructure around payments built on Arc:

- making Arc payment flows easier to integrate into API products;
- turning transaction memos into app-level reconciliation;
- giving builders local receipt and webhook workflows before they build production storage;
- creating reusable open-source patterns for Arc Testnet payment operations;
- making stablecoin payments feel operable, not only payable.

## Why Funding Is Needed

The project has already proven the local Settlary Receipts workflow: invoices, memo payment requests, receipt generation, signed webhooks, replay, and local persistence.

Grant funding would move the project from a working local SDK into reusable infrastructure for developers building on Arc. The funded work focuses on production persistence, durable watcher behavior, refund lifecycle state, framework integrations, and reviewer-friendly hosted demos.

Without funding, the project can continue as a small experimental SDK. With funding, it can become a maintained open-source payment operations layer that other Arc apps can adopt instead of rebuilding receipt, webhook, replay, and reconciliation logic themselves.

## Current Limits

This is an early open-source SDK and local demo, not a hosted payment platform.

Current limits are explicit:

- the default hosted/demo path is in-memory unless local SQLite persistence is enabled;
- SQLite local/dev persistence is shipped, while Postgres production persistence is planned;
- hosted persistent storage is planned, not shipped;
- onchain proof mode is read-only and does not broadcast transactions;
- watcher cursor persistence exists locally, but does not replace a hosted indexer or durable production watcher runtime;
- default middleware verification is not a production Gateway verification path unless the app provides a custom verifier;
- hosted dashboard and analytics are planned, not shipped;
- Fastify, Hono, Python, and Go adapters are planned, not shipped;
- refund and partial refund accounting are planned, not shipped.

## Grant Milestones

The most useful funded milestones move the project from a proven local workflow toward reusable production-facing infrastructure:

1. Postgres receipt store and production persistence
   - Add a Postgres adapter for invoices, receipts, webhook events, delivery attempts, and watcher cursors. Keep SQLite for local/dev and make Postgres the production-oriented backend for hosted apps.

2. Durable watcher runtime
   - Harden watcher resume behavior with persisted cursor state, idempotent receipt creation, retry-safe scans, structured logs, and examples for long-running server processes.

3. Framework webhook integrations
   - Ship production-friendly Next.js route helpers plus Express examples for raw body handling, `x-settlary-signature` verification, delivery recording, replay, and typed success/failure responses.

4. Refund and partial refund lifecycle
   - Add full and partial refund states, counter-payment matching, refund webhook events, and receipt transitions for app-level reconciliation.

5. Hosted reviewer and builder demo
   - Publish a reviewer-friendly hosted demo and docs that clearly show simulated and Arc Testnet-backed flows: invoice, memo payment data, proof polling, receipt generation, signature verification, replay, and persistence mode.

## Reviewer Demo

Use [demo-script.md](demo-script.md) to reproduce the local demo flow.

Expected proof points:

- `Run Watcher Flow` produces invoice, memo, watcher, receipt, and webhook data.
- Optional `Onchain Proof` watches Arc Testnet Memo logs or verifies a real transaction hash against the generated memo payment request.
- `Webhook Inbox` shows `Received`, `Verified`, and `Signature OK`.
- `Replay Webhook` creates `Delivery attempt #2`.
- The replayed attempt has a fresh signature timestamp.
