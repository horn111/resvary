# Migrate from 0.6 to 0.7

Upgrade all six Resvary packages together. Pricing, funding protocols, existing event fields, and CLI flags do not change. The release adds policy events and optional usage-receipt allocations.

## Before rollout

1. Back up the database and test restoration.
2. Confirm each account satisfies `0 <= reservedUnits <= postedUnits`.
3. Confirm the sum of open reservation units equals the account's `reservedUnits`.
4. Stop manual database edits and keep the backup until allocation verification passes.

The migration creates one non-expiring legacy lot for each existing account with a positive posted balance. It maps every open reservation to that lot. Existing grants, funding transactions, historical usage receipts, and closed reservations are not rewritten. Migration aborts rather than guessing when account and reservation totals differ.

## SQLite

Opening a v4 credit database with `@resvary/sqlite` 0.7 applies schema v5 automatically in one `BEGIN IMMEDIATE` transaction. SQLite remains for local and single-node deployments.

```bash
npm install @resvary/sdk@0.7.0 @resvary/sqlite@0.7.0
```

After startup, read representative balances, lots, and open reservations. A restart must preserve the same values.

## PostgreSQL

PostgreSQL migration remains an explicit deployment step. Apply v3 before starting 0.7 application and worker processes:

```bash
npm install @resvary/sdk@0.7.0 @resvary/postgres@0.7.0 @resvary/worker@0.7.0
resvary-postgres status
resvary-postgres migrate
resvary-postgres status
```

The final status must report schema version 3. PostgreSQL 16, 17, and 18 are supported. Store construction never applies DDL.

## SQLite to PostgreSQL import

The 0.7 importer accepts SQLite schema v5 and requires PostgreSQL schema v3. It verifies table counts, canonical payloads, account snapshots, ledger totals, lot balances, open reservation allocations, and open reservation counts. Run a dry run before cutover:

```bash
resvary-postgres import-sqlite --sqlite .resvary/resvary.sqlite --dry-run
resvary-postgres import-sqlite --sqlite .resvary/resvary.sqlite
resvary-postgres verify-import --sqlite .resvary/resvary.sqlite
```

## Application changes

No application change is required for existing grant/reserve/commit/release flows. To use policies, call `createGrantPolicy`, then explicitly call `applyAllowance` or `claimPromotion` from an authorized application path. Do not grant policy credits automatically in starter initialization.

If a custom store implements only `CreditStore`, previous operations remain supported. New policy methods fail closed with `UnsupportedCreditStoreCapabilityError` until the store adds `CreditPolicyStore`.
