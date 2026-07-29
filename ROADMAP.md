# Roadmap

> Last updated: June 2026

Settlary is an early open-source payment operations toolkit for stablecoin apps, built on Arc. The current focus is narrow on purpose: make Arc payment flows easier to run, inspect, and operate locally before moving toward persistent production infrastructure.

## Shipped

### Core SDK

- [x] TypeScript monorepo
- [x] Express middleware for x402-style paywalled endpoints
- [x] Next.js Route Handler adapter
- [x] Buyer SDK with `402 -> sign -> retry` flow
- [x] Arc chain configuration and constants
- [x] Middleware test coverage
- [x] Billing and receipts test coverage

### Billing

- [x] Per-request pricing model
- [x] Per-second pricing model
- [x] Per-job pricing model
- [x] In-memory usage metering

### Settlary Receipts

- [x] Invoice helpers
- [x] Transaction memo helpers
- [x] Receipt matching
- [x] In-memory receipt ledger
- [x] HMAC-signed webhook events
- [x] Arc Testnet watcher for memo-wrapped USDC payments
- [x] Read-only Arc Testnet proof polling and tx proof for memo payment requests
- [x] Local webhook inbox
- [x] Webhook replay attempts with fresh signature timestamps

### Developer Experience

- [x] Local Next.js demo app
- [x] Interactive watcher flow in the demo
- [x] Webhook Inbox + Replay demo flow
- [x] Optional Onchain Proof demo panel with Memo-log polling
- [x] Repo-local `create-settlary` scaffolder
- [x] Grant snapshot and demo script docs

## Next Grant Milestones

### Persistent Receipt Store

- [x] SQLite receipt store adapter
- [ ] Postgres receipt store adapter
- [x] Persistent invoices, receipts, webhook events, and delivery attempts
- [ ] Import/export path for local demo data

### Persistent Watcher Cursor

- [x] Store last scanned block per watched invoice or memo id
- [x] Resume watcher safely after process restart
- [x] Avoid duplicate receipt creation after replayed scans
- [x] Expose cursor state for local debugging

### Next.js Webhook Route Helpers

- [x] Raw body reader for signed webhook payloads
- [x] `x-settlary-signature` verification helper
- [x] Delivery attempt recording helper
- [x] Typed success/failure responses for route handlers

### Refund And Partial Refund State

- [ ] Refund receipt status model
- [ ] Partial refund accounting
- [ ] Counter-payment matching
- [ ] Webhook events for refund lifecycle changes

### Hosted Demo Flow

- [ ] Reviewer-friendly hosted demo
- [ ] Demo script embedded in docs
- [ ] Clear "what is simulated vs onchain" labeling
- [ ] Short walkthrough assets for grant reviewers

## Later

### Gateway Readiness

- [ ] Deposit readiness helpers
- [ ] Pending settlement state
- [ ] Balance monitoring and alerts
- [ ] Multi-chain balance visibility

### Dashboard And Analytics

- [ ] Usage analytics API
- [ ] Revenue tracking
- [ ] Per-endpoint cost breakdown
- [ ] Receipt and webhook delivery views

### Multi-Framework Support

- [ ] Fastify adapter
- [ ] Hono adapter
- [ ] Python SDK
- [ ] Go SDK

### Agent Commerce

- [ ] Agent payment policy examples
- [ ] Agent-to-agent paid API examples
- [ ] Budget-aware buyer flows
- [ ] Service discovery experiments

## Current Non-Goals

- Hosted managed payment platform
- Production webhook queue
- Default production Gateway verification without an app-provided verifier
- Persistent receipt database in the current MVP
- Fastify/Hono/Python/Go adapters in the current MVP

## Grant Framing

The highest-impact next step is to turn the current local Settlary Receipts proof into a more durable builder workflow:

```text
local payment ops proof
-> persistent receipts
-> resumable watcher
-> webhook route helpers
-> refund states
-> hosted reviewer demo
```

See [docs/grant.md](docs/grant.md) and [docs/demo-script.md](docs/demo-script.md) for the grant-ready project summary and local demo walkthrough.
