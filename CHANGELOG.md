# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Pivoted

- Repositioned Resvary as open-source prepaid credits and usage billing for AI products; Arc is now an optional USDC funding rail.

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

- Standardized the current alpha under the **Resvary** product identity across repository metadata, documentation, demo copy, package metadata, and brand assets.
- Moved npm packages to the `@resvary/*` scope and renamed the scaffolder to `create-resvary`.
- Renamed the Arc Receipts module to **Resvary Receipts**.
- Renamed public receipt types to `PaymentInvoice`, `PaymentReceipt`, `ReceiptOnchainProof`, and `ReceiptWatcher`.
- Renamed the webhook header to `x-resvary-signature`, local configuration to `RESVARY_RECEIPTS_*`, the memo namespace to `resvary`, and the default data directory to `.resvary`.

### Added

- Resvary Receipts MVP with invoice memos, receipt matching, in-memory ledger, and signed webhook helpers.
- Arc Testnet watcher for memo-wrapped USDC payments, plus memo payment request helpers and official Arc Testnet contract constants.
- Webhook Inbox + Replay for local signed-webhook delivery verification and replay attempts.
- Persistent Resvary Receipts foundation with `ReceiptStore`, `InMemoryReceiptStore`, `PersistentReceiptLedger`, and `PersistentWebhookInbox`.
- Optional `@resvary/sqlite` workspace package for local SQLite persistence of invoices, receipts, webhook deliveries, and watcher cursors.
- Store-backed watcher cursors and a framework-light signed webhook route handler.

## [0.2.0-alpha] - 2026-06-02

### Added

- `create-resvary` CLI tool for scaffolding projects (`npx create-resvary`)
- Interactive prompts for framework (Express/Next.js) and pricing model

## [0.1.0-alpha] - 2025-05-23

### Added

- Initial project scaffolding with monorepo structure
- `@resvary/sdk` — core SDK with Express & Next.js middleware
- Buyer SDK for automated x402 payment flow
- Usage metering and billing plan engine
- Circle Gateway unified balance client
- Demo app with paywalled API endpoints
- Architecture documentation and getting-started guide
- CI/CD pipeline with GitHub Actions
- Security policy and contribution guidelines

[unreleased]: https://github.com/horn111/resvary/compare/v0.1.0-alpha...HEAD
[0.1.0-alpha]: https://github.com/horn111/resvary/releases/tag/v0.1.0-alpha
