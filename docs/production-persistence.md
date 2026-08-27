# Production Persistence for Design Partners

Resvary 0.5 is a self-hosted design-partner alpha. Postgres supports multiple application and worker processes, but this release does not include a hosted control plane, SLA, RBAC, or managed operations.

## Provisioning

- Use PostgreSQL 16 or newer with TLS outside a private local network.
- Create a dedicated database role. The migration job needs DDL rights; application and worker roles need DML rights on the selected schema.
- Start with a pool of 5–10 connections per application process and measure saturation before increasing it.
- Store `DATABASE_URL` and `RESVARY_WEBHOOK_SECRET` in the deployment secret manager. Never put them in images or logs.

Apply schema changes as a separate deployment step:

```bash
resvary-postgres status
resvary-postgres migrate
```

Store constructors fail against missing tables; they never migrate automatically.
Postgres schema v2 adds domain checks, relational constraints, and global payment transaction-hash uniqueness. A migration stops if existing data violates a new invariant; reconcile the reported rows before retrying.

## Application and workers

Run at least one application process and one `resvary-worker run` process. Additional workers coordinate through leased outbox claims.
Set a stable, unique `RESVARY_WORKER_ID` for every replica. The worker CLI shares one Postgres pool between delivery and readiness checks, so `/ready` does not open a new pool per request.

```dotenv
DATABASE_URL=postgres://...
RESVARY_POSTGRES_SCHEMA=public
RESVARY_WEBHOOK_URL=https://merchant.example/webhooks/resvary
RESVARY_WEBHOOK_SECRET=...
RESVARY_WORKER_ID=resvary-worker-1
RESVARY_HEALTH_PORT=8081
```

`/live` reports whether the worker is stopping. `/ready` checks database connectivity, schema version, and current pending/dead-letter counts. Delivery is at least once; consumers must deduplicate by `x-resvary-event-id`.

## Monitoring

Alert on readiness failures, increasing dead-letter count, sustained pending event growth, transaction retry exhaustion, connection pool saturation, and the age of the oldest pending event. JSON worker logs include event ID, type, attempt, latency, and sanitized error, never secret or payload.

Inspect and recover dead letters explicitly:

```bash
resvary-worker dead-letter list
resvary-worker dead-letter requeue evt_123
```

## Backup and recovery

Use managed Postgres point-in-time recovery or regular `pg_dump` backups. Test restoration into a separate database. Restarting a worker is safe: an event held by a stopped worker becomes claimable when its lease expires.

Do not edit account snapshots, ledger entries, or idempotency rows manually. Corrections should use domain adjustments; delivery recovery should use the dead-letter command.

## Incident response

1. Stop workers if an endpoint is returning permanent failures.
2. Keep application writes running only if the database remains healthy; outbox events stay durable.
3. Fix the endpoint or secret, inspect dead letters, then requeue selected events.
4. If database correctness is in doubt, stop application writes and restore or reconcile before restarting workers.
