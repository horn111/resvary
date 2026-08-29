# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Made `BuyerClient` fail closed on `402` responses unless the caller supplies exact recipient and origin policy, a per-request limit, and a client-instance total budget.
- Replaced floating-point x402 amount conversion with exact six-decimal stablecoin parsing and rejected malformed, expired, wrong-network, and unapproved payment requirements before signing.
- Reserved the `BuyerClient` total budget before asynchronous approval and froze approved payment terms to prevent concurrent or callback-driven limit bypasses.
- Re-verified direct Arc transaction evidence through RPC before every credit grant, including recovery from persisted receipts, and bound the proof to payment terms reconstructed from the funding intent.
- Prevented a project-scoped ledger from replacing another project's funding intent through a reused caller-selected ID.
- Restricted CI credentials to read-only repository access, stopped checkout credential persistence, and removed runtime-generated code from the demo's optional SQLite import.

### Changed

- Added `--help` output to all three public CLIs and verified it in package smoke tests.
- Declared Node.js 20+ support in the SDK, Circle adapter, and `create-resvary` package metadata. SQLite and the demo continue to require Node.js 24+.
- Allowed verified direct Arc overpayments while deriving the credited amount from onchain proof instead of receipt fields.

### Compatibility

- Existing databases require no migration.
- Automatic `BuyerClient` payments now require `paymentPolicy`. Direct Arc confirmation now requires a working Arc RPC connection; the expected payment request is reconstructed from the funding intent and is never trusted from caller input.

## [0.5.0] - 2026-08-28

### Changed

- Promoted the self-hosted SDK, Postgres persistence, and outbox worker to the stable `0.5.0` release channel.
- Made Postgres 16–18 the recommended backend for multi-process deployments; SQLite remains supported for local and single-node use.
- Updated package metadata, starter templates, installation instructions, and product copy to use the stable npm release.

### Compatibility

- Kept the public TypeScript API, CLI flags, webhook and outbox events, and SQLite/Postgres schemas identical to `0.5.0-alpha.3`.
- Upgrading from `0.5.0-alpha.3` requires only a package version change and does not run a database migration.

### Limits

- The self-hosted release does not include a hosted control plane, SLA, RBAC, compliance certification, or managed operations.
- Direct Arc and Circle Gateway funding remain Testnet-only and do not represent a production settlement or custody claim.

## [0.5.0-alpha.3] - 2026-08-27

### Fixed

- Prevented one funding transaction or payment receipt transaction hash from granting or paying more than one record.
- Made receipt state changes and their webhook events atomic on transactional stores.
- Added attempt fencing so an expired outbox lease cannot acknowledge or fail a newer delivery attempt.
- Hardened generated starters, worker configuration, health checks, SQLite import verification, and CLI argument parsing.

### Changed

- Added Postgres schema v2 constraints and a tested sequential v1-to-v2 migration.
- Expanded CI to build all generated SQLite/Postgres starters and test PostgreSQL 16, 17, and 18.
- Made starter smoke tests install locally packed release candidates so a new exact version is verified before npm publication.
- Completed the public 0.4 funding evidence record with release metadata and tag-pinned Arc and Gateway proof files.

## [0.5.0-alpha.2] - 2026-08-27

### Production persistence

#### Added

- `@resvary/postgres` with complete credit and receipt stores on direct `pg`.
- Explicit advisory-lock schema migrations, health reporting, and offline SQLite import verification.
- Serializable credit transactions with bounded retry for serialization, deadlock, and concurrent uniqueness conflicts.
- `@resvary/worker` library and CLI with leased claims, signed HTTP delivery, exponential retry, dead-letter state, and manual requeue.
- Postgres deployment option in `create-resvary`, a deployment example, PostgreSQL CI, and a design-partner runbook.

#### Changed

- Expanded outbox events with processing, delivery attempt, lease, retry, and failure state.
- Migrated SQLite credits through schema v4 while retaining SQLite as the local and single-node backend.
- Published workspace packages as `0.5.0-alpha.2` under the npm `alpha` dist-tag with explicit public access, exact internal dependency versions, and installable CLI entrypoints.

#### Security

- Worker logs exclude webhook secrets and event payloads.
- Migration and import commands remain explicit; store construction never changes a Postgres schema.

### 0.4 Alpha - Circle-native funding proof

#### Added

- Funding rails and settlement evidence with uniqueness by `rail + network + externalPaymentId`.
- SQLite schema migration v2 with automatic backfill of existing direct Arc funding records.
- `ArcFundingWorker` for persisted resume, bounded scans, confirmation depth, overlap rescans, RPC retry, and crash reconciliation.
- Optional `@resvary/circle` package using the official `@circle-fin/x402-batching` facilitator client.
- Gateway Nanopayment verification, settlement, exact-amount checks, authorization hashing, and exactly-once credit grants.
- Framework-neutral Request/Response handler plus Next.js and Express-compatible adapters.
- Dual-rail demo, buyer example, recovery guide, 0.3-to-0.4 migration guide, video plan, and public evidence checklist.

#### Changed

- Renamed the misleading legacy `GatewayClient` implementation to `ArcWalletBalanceClient`; the old name remains as a deprecated alias.
- Removed the non-functional `ARC_MAINNET` placeholder.
- Updated package versions to `0.4.0-alpha.0`.

#### Security

- Gateway credits are granted only after successful facilitator settlement.
- Full payment signatures and private keys are never persisted.
- Later adverse Gateway events move funding to `reconciliation_required` without silently reversing spent credits.

### Pivoted

- Repositioned Resvary as open-source prepaid credits and usage billing for AI products; Arc is the reference external USDC funding path.

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

[unreleased]: https://github.com/horn111/resvary/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/horn111/resvary/compare/v0.5.0-alpha.3...v0.5.0
[0.5.0-alpha.3]: https://github.com/horn111/resvary/compare/v0.5.0-alpha.2...v0.5.0-alpha.3
[0.5.0-alpha.2]: https://github.com/horn111/resvary/compare/v0.5.0-alpha.0...v0.5.0-alpha.2
[0.1.0-alpha]: https://github.com/horn111/resvary/releases/tag/v0.1.0-alpha
