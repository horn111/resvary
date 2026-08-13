# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Pivoted

- Repositioned Settlary as open-source prepaid credits and usage billing for AI products; Arc is now an optional USDC funding rail.

### Added

- USD credit accounts with integer arithmetic, manual grants, adjustments, reservations, expiry, actual-usage commits, and usage receipts.
- Multi-dimensional meters, immutable price versions, and deterministic integer rating.
- Persistent idempotency, immutable ledger entries, transactional outbox events, and signed credit webhooks.
- `CreditStore`, `InMemoryCreditStore`, and transactional `SqliteCreditStore` with versioned schema metadata.
- Arc Testnet funding intents and exactly-once payment receipt to credit grant confirmation.
- New prepaid AI credits demo, optional OpenAI-compatible mode, and AI starter templates.
- Migration, pricing, funding, persistence, security, grant pivot, and prepaid-credit documentation.

### Deprecated

- `UsageMeter` and `createBillingPlan` remain compatible but should not be used as a balance source of truth.

### Changed

- Renamed the project from `arc-nano-kit` to **Settlary** to align with the Arc Brand Guidelines and establish an independent product identity.
- Renamed npm packages from `@arc-nano-kit/*` to `@settlary/*` and the scaffolder from `create-arc-nano-kit` to `create-settlary`.
- Renamed the Arc Receipts module to **Settlary Receipts**.
- Renamed public receipt types to `PaymentInvoice`, `PaymentReceipt`, `ReceiptOnchainProof`, and `ReceiptWatcher`.
- Renamed the webhook header to `x-settlary-signature`, local configuration to `SETTLARY_RECEIPTS_*`, the memo namespace to `settlary`, and the default data directory to `.settlary`.

### Added

- Settlary Receipts MVP with invoice memos, receipt matching, in-memory ledger, and signed webhook helpers.
- Arc Testnet watcher for memo-wrapped USDC payments, plus memo payment request helpers and official Arc Testnet contract constants.
- Webhook Inbox + Replay for local signed-webhook delivery verification and replay attempts.
- Persistent Settlary Receipts foundation with `ReceiptStore`, `InMemoryReceiptStore`, `PersistentReceiptLedger`, and `PersistentWebhookInbox`.
- Optional `@settlary/sqlite` workspace package for local SQLite persistence of invoices, receipts, webhook deliveries, and watcher cursors.
- Store-backed watcher cursors and a framework-light signed webhook route handler.

## [0.2.0-alpha] - 2026-06-02

### Added

- `create-settlary` CLI tool for scaffolding projects (`npx create-settlary`)
- Interactive prompts for framework (Express/Next.js) and pricing model

## [0.1.0-alpha] - 2025-05-23

### Added

- Initial project scaffolding with monorepo structure
- `@settlary/sdk` — core SDK with Express & Next.js middleware
- Buyer SDK for automated x402 payment flow
- Usage metering and billing plan engine
- Circle Gateway unified balance client
- Demo app with paywalled API endpoints
- Architecture documentation and getting-started guide
- CI/CD pipeline with GitHub Actions
- Security policy and contribution guidelines

[unreleased]: https://github.com/horn111/settlary/compare/v0.1.0-alpha...HEAD
[0.1.0-alpha]: https://github.com/horn111/settlary/releases/tag/v0.1.0-alpha
