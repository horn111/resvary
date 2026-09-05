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

The Compose stack runs the PostgreSQL migration as a separate one-shot service before starting the console. The console itself never runs PostgreSQL DDL. It exits when the database schema is not exactly v4.

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
- **Audit Explorer** filters by customer, entity, kind, type, status, and time range. Usage receipts link the charge, reservation, price version, and ledger entries. The original stored JSON remains visible.
- **Operations** reports database/schema health, overdue reservations, dead-letter events, and the append-only operator action log.

Lists use opaque keyset cursors over `(createdAt, id)`, newest first. Pages default to 50 items and reject limits above 100.

## Allowed operations

The console exposes four narrow commands:

- a positive manual grant;
- a signed balance adjustment with a required reason and a result preview;
- an expiry sweep limited to reservations that are already overdue;
- requeue of an event whose current status is `dead_letter`.

Every command receives a UUID that is also the idempotency identity. The console writes an append-only `OperatorAction` before execution and appends the outcome afterward. If the process stops between those records, retrying the same command recovers through the underlying idempotency record.

The console does not expose arbitrary reservation release, usage commit, funding confirmation, pricing/policy CRUD, refund, or history deletion.

## Library contracts

Framework-neutral admin contracts are exported by `@resvary/sdk/admin`. Backend implementations are exported by `@resvary/sqlite/admin` and `@resvary/postgres/admin`.

```ts
import type { AdminPage, AdminQueryStore, AuditItem, OperatorAction } from '@resvary/sdk/admin';
import { OperatorService } from '@resvary/sdk/admin';
import { createSqliteAdminStore } from '@resvary/sqlite/admin';
```

`AdminQueryStore` is an optional capability. The required `CreditStore` interface is unchanged, so existing custom stores remain source-compatible.

The routes under `apps/console/src/app/api` are private implementation details of the console. Resvary 1.0 does not publish or support them as an external Admin HTTP API.

See [Migration to 1.0](migration-1.0.md) before connecting the console to an existing database and [Operator Console runbook](operator-console-runbook.md) before a production rollout.
