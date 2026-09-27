# Operator Console

Resvary 1.0 adds a self-hosted console for answering two operational questions without writing SQL:

1. Why does this customer have this balance?
2. What can an operator safely do to recover a failed workflow?

One console instance is pinned to one `RESVARY_PROJECT_ID`. It cannot query or mutate another project. PostgreSQL is the production backend; SQLite is supported for local development and single-node deployments.

## Run with Docker Compose

Use a random admin secret of at least 32 characters and a separate PostgreSQL password:

```bash
export POSTGRES_PASSWORD='replace-with-a-database-password'
export RESVARY_PROJECT_ID='my_ai_product'
export RESVARY_CONSOLE_ADMIN_SECRET='replace-with-at-least-32-random-characters'
docker compose -f docker-compose.console.yml up -d
```

The Compose stack runs the PostgreSQL migration as a separate one-shot service before starting the console. The console itself never runs PostgreSQL DDL. It exits when the database schema does not match its bundled store version: PostgreSQL v6 for the unreleased 1.3 build.

The image is published as `ghcr.io/horn111/resvary-console`. Release tags are multi-platform (`linux/amd64` and `linux/arm64`) and are accompanied by an SBOM, vulnerability scan, build provenance, and an immutable digest.

## Configuration

| Variable                         | Required        | Meaning                                                         |
| -------------------------------- | --------------- | --------------------------------------------------------------- |
| `RESVARY_PROJECT_ID`             | yes             | The only project visible to this instance                       |
| `RESVARY_CONSOLE_ADMIN_SECRET`   | yes             | Shared admin secret, at least 32 characters                     |
| `DATABASE_URL`                   | PostgreSQL only | PostgreSQL connection string                                    |
| `RESVARY_SQLITE_PATH`            | SQLite only     | Path to the local database                                      |
| `RESVARY_CONSOLE_DEMO_MODE=true` | preview only    | Loads the bundled synthetic fixture and disables every mutation |

Configure exactly one of `DATABASE_URL` and `RESVARY_SQLITE_PATH`. Demo mode rejects both variables and only opens the bundled synthetic SQLite fixture.

## Authentication boundary

The login secret is compared with a timing-safe check. A successful login creates a signed `Secure`, `HttpOnly`, `SameSite=Strict`, host-only cookie. Sessions include a fingerprint of the current secret, so rotating the secret immediately invalidates existing cookies. Login failures are throttled, and mutation requests require an exact same-origin request.

Terminate TLS at the console or at a trusted reverse proxy that preserves the public request URL. Do not expose an unencrypted HTTP endpoint: the secure session cookie is intentionally unavailable over plain HTTP.

The health endpoint is also protected:

```bash
curl -H "Authorization: Bearer $RESVARY_CONSOLE_ADMIN_SECRET" \
  https://console.example.com/api/health
```

## Sections

- **Overview** shows posted, reserved, and available balances; charges over 24 hours, 7 days, and 30 days; overdue reservations; outbox and dead-letter counts; funding reconciliation; and a recent activity ledger.
- **Customers** searches customer IDs and opens balances, credit lots, grants, reservations, receipts, funding records, and one chronological timeline.
- **Audit Explorer** filters by customer, entity, kind, type, status, and time range. Usage receipts link the charge, reservation, price version, and ledger entries. Stored evidence remains visible; metered operation records use a safe field allowlist that excludes execution credentials and provider content.
- **Operations** reports database/schema health, metered-operation backlog, overdue reservations, dead-letter events, and the append-only operator action log. In 1.3, filter operations by status, search, and last-update age, then open the charge evidence and recovery controls.

Lists use opaque keyset cursors over `(createdAt, id)`, newest first. Pages default to 50 items and reject limits above 100.

## Allowed operations

The console exposes narrow commands:

- a positive manual grant;
- a signed balance adjustment with a required reason and a result preview;
- an expiry sweep limited to reservations that are already overdue;
- requeue of an event whose current status is `dead_letter`;
- settlement or explicit reconciliation of an immutable saved operation result;
- marking a stopped worker’s outcome unknown;
- confirming non-execution with external evidence before cancelling an unknown operation.

Every command receives a UUID that is also the idempotency identity. The console records the normalized command parameters, including amount or expiry cutoff, in an append-only `OperatorAction` before execution and appends the outcome afterward. Reusing a UUID with changed parameters returns a conflict. If the process stops between journal records, retry the same command unchanged; the underlying ledger idempotency and durable operation state prevent a second charge. Recovery commands never call the provider.

For overdue sweeps, the HTTP handler lets `OperatorService` select and persist the cutoff on the first request. Retrying the same UUID after a lost response uses that original cutoff and result, even if more reservations have expired since then. Use a new UUID to start a new sweep.

The console does not expose arbitrary reservation release, usage commit, funding confirmation, pricing/policy CRUD, refund, or history deletion.

## Library contracts

Framework-neutral admin contracts are exported by `@resvary/sdk/admin`. Backend implementations are exported by `@resvary/sqlite/admin` and `@resvary/postgres/admin`.

```ts
import type { AdminPage, AdminQueryStore, AuditItem, OperatorAction } from '@resvary/sdk/admin';
import { OperatorService } from '@resvary/sdk/admin';
import { createSqliteAdminStore } from '@resvary/sqlite/admin';
```

`AdminOperationStore` adds paginated operation queries, health, and transition history. Bundled admin stores implement both contracts. `AdminQueryStore` is an optional capability. The required `CreditStore` interface is unchanged, so existing custom stores remain source-compatible.

The routes under `apps/console/src/app/api` are private implementation details of the console. Resvary does not publish or support them as an external Admin HTTP API.

See [Migration to 1.3](migration-1.3.md) before connecting the console to an existing database and [Operator Console runbook](operator-console-runbook.md) before a production rollout.

## Browser verification

Build the console before running `npm run test:e2e --workspace=@resvary/console`. The suite seeds recovery cases into an ignored copy of the fixture; it does not alter the bundled demo database. Install Playwright Chromium with `npx playwright install chromium --only-shell` when needed. For a preinstalled browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path. Set `RESVARY_CAPTURE_REVIEW=1` to save desktop and mobile recovery screenshots under the ignored `.impeccable/review/` directory.
