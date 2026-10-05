# Production operations

The npm release remains **1.3.1**. Application-only changes carry their own Git commit, reported by `GET /api/version` on both production sites and by Agent Demo's `GET /api/health` and authenticated `GET /api/status`.

## Deployment gate

Both Vercel projects connect to `horn111/resvary`, production branch `main`:

| Project              | Root              | Production domain   |
| -------------------- | ----------------- | ------------------- |
| `resvary`            | `apps/demo`       | `www.resvary.xyz`   |
| `resvary-agent-demo` | `apps/agent-demo` | `agent.resvary.xyz` |

Each project requires the GitHub check **Production CI gate** before assigning production domains. The CI job waits for type checking, builds, workspace tests, PostgreSQL 16–18, SQLite, browser tests, and container scans. A failed, cancelled, or skipped dependency fails the gate. Vercel matches the check to the deployment's commit.

Configure the project check with source `git-provider`, provider `github`, external check name `Production CI gate`, target `production`, `requires: none`, `blocks: deployment-alias`, and a 7,200-second timeout. Preserve the check when renaming jobs or reconnecting Git. Do not use Force Promote to work around a failed check. An administrator's force-promotion capability remains outside this automated gate.

After merging, wait for the main-commit CI and both deployments. Compare each `/api/version` commit with the approved commit. A build marked Ready may still be waiting for the production check. The root `.vercel` link points to Agent Demo; `apps/demo/.vercel` points to the marketing site.

Before the first deployment of these operations changes, run Agent Demo's existing migration command against the intended production database. It adds `agent_demo.maintenance`; it does not change the SDK ledger schema. Keep production credentials in Vercel and an ignored operator environment file.

## Maintenance and retention

Agent Demo registers `GET /api/internal/maintenance` at `17 3 * * *` UTC. Vercel sends the existing `CRON_SECRET` as a bearer token. The handler checks the secret before accessing the database, claims a six-minute database lease, and records success only after cleanup, reservation expiry, reconciliation, and dispatch draining complete. Logs contain counts and build identity, not document content or credentials.

The current Vercel Hobby plan supports one run per cron per day, with execution sometime within the scheduled hour. See [Vercel's limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). Each started Workflow separately schedules content removal at its 24-hour expiry. Daily cron supplies a fallback for abandoned dispatches and platform interruptions; it does not guarantee a strict 24-hour deletion deadline. Health checks flag content still present five minutes after expiry.

Cleanup removes submitted documents and saved results, retaining receipts and accounting evidence. It records a `content.expired` event with `expiresAt` and `clearedAt` in the same SQL statement. Repeating cleanup produces no second event. Historical jobs cleared before this change have no deletion timestamp.

An authorized operator can call the maintenance endpoint to verify the first deployment. A successful manual call proves the handler, authentication, and database changes; the recorded Vercel cron definition proves registration. Subsequent scheduled success updates the same heartbeat. Never submit another payment or AI request to test maintenance.

## Health and alerts

The **Production health** GitHub Actions workflow runs on a 15-minute schedule and can be dispatched manually. It reads public, aggregate endpoints without creating accounts or accessing secrets. Three attempts absorb brief cold-start or network failures. GitHub can delay scheduled runs; this is a pilot monitor, not an uptime SLA. GitHub Actions notification preferences determine email/web delivery of failed runs.

Agent Demo returns HTTP 503 when any operational check needs attention:

| Issue                      | Trigger and response                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `budget_low`               | Remaining internal provider allowance is at most 20%; inspect actual spend and unresolved holds. |
| `budget_exhausted`         | Less than one 0.40-unit run reserve remains; admission already rejects new work.                 |
| `dispatch_overdue`         | A live queued job has no Workflow ID after two minutes; inspect dispatch and run maintenance.    |
| `execution_overdue`        | The global execution owner is older than ten minutes; reconcile the unknown outcome.             |
| `settlement_overdue`       | A saved result is still unsettled ten minutes after execution began.                             |
| `operator_review_required` | A job has an unknown outcome awaiting an evidence-based operator decision.                       |
| `content_cleanup_overdue`  | Expired content remains after the five-minute observation allowance.                             |
| `maintenance_overdue`      | No successful maintenance run in 26 hours.                                                       |
| `maintenance_failed`       | A failed attempt is newer than the last successful run.                                          |
| `admission_paused`         | The operator disabled new runs.                                                                  |
| `operations_unavailable`   | Configuration, schema, or database health could not be read.                                     |

The public response contains issue codes and build identity only. Inspect private job and ledger records through the operator workflow when a check fails. Health checks do not call AI models, move funds, renew Circle sessions, or verify the external AI account's cash balance. The internal allowance is separate from user credit balances and provider account funding.

## Dependency maintenance

The **Dependency maintenance** workflow runs daily at 05:29 UTC. It runs the production advisory gate and checks every exception for an upstream package release and its deadline. It fails within three days of expiry to prompt review. The normal audit gate still rejects expired exceptions.

As of October 5, `node-forge@1.4.0` has no newer npm release. The reviewed exception expires October 19 and belongs to `horn111`; see [dependency security](dependency-security.md). A newer version triggers review rather than an automatic override. No deadline is extended automatically.

## Evidence

The [October 5 Mainnet snapshot](evidence/mainnet/2026-10-05.md) verifies an existing wallet deposit and paid usage. It records the scope and limitations of read-only verification and keeps submitted content, credentials, and session identifiers out of the public report.
