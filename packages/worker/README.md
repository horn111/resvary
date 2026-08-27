# @resvary/worker

At-least-once delivery for Resvary credit outbox events. Receivers must deduplicate by `x-resvary-event-id` before applying side effects.

```bash
npm install @resvary/worker@alpha
DATABASE_URL=postgres://... \
RESVARY_WEBHOOK_URL=https://example.com/webhooks/resvary \
RESVARY_WEBHOOK_SECRET=replace-me \
npx resvary-worker run
```

Defaults: batch 25, lease 30 seconds, webhook timeout 10 seconds, maximum 8 attempts, exponential backoff with jitter. HTTP `2xx` succeeds. Network failures, timeout, `408`, `429`, and `5xx` retry. Other `4xx` responses move directly to dead letter.

Optional health endpoints are enabled with `RESVARY_HEALTH_PORT`. Use `/live` for process liveness and `/ready` for database and schema readiness.

```text
resvary-worker dead-letter list
resvary-worker dead-letter requeue EVENT_ID
```

Run each replica with a unique `RESVARY_WORKER_ID`, or omit it to generate a process-unique ID. JSON logs contain event identifiers and sanitized errors, never webhook secrets or event payloads.
