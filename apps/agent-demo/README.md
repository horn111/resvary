# Resvary agent demo

Resvary shows an AI agent buying a paid document-analysis service with product credits. If the visitor account lacks credits, the server uses a Circle Agent Wallet to fund the shortfall through Circle Gateway on Arc Testnet. Resvary reserves the quoted product credits, saves the provider result, charges measured usage, and returns the saved result with its receipt.

The Vercel deployment keeps the OpenAI Agents SDK for the agent loop. The selected Nous configuration uses `qwen/qwen3.8-flash` for the buying agent and `openai/gpt-4.1-mini` for the document-analysis service.

## Deployment status

| Item                    | Current status                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel project          | `resvary-agent-demo`                                                                                                                         |
| Production URL          | <https://agent.resvary.xyz> points to a `READY` production deployment; the Vercel URL remains available as a fallback.                       |
| Web and execution stack | Next.js 16, Vercel Workflow `4.8.8`, Node.js 24                                                                                              |
| Database                | Managed Neon PostgreSQL, free plan, `fra1`; migrations passed.                                                                               |
| Source verification     | 43 agent-demo tests, 17 nanopayment and credit-gate tests, and the compiled Workflow browser E2E passed.                                     |
| AI provider             | Nous selected for both roles                                                                                                                 |
| Hyperbolic              | A key probe returned HTTP 401. Hyperbolic has not passed provider verification.                                                              |
| Circle readiness        | Operator and deployed-cloud checks passed for the Testnet session, Agent Wallet, backing EOA, and Gateway balance.                           |
| Circle payment          | Gateway accepted one real 0.02 Testnet USDC payment; Resvary issued one funding grant. Batch onchain confirmation remains unverified.        |
| Vercel build            | Linux production build passed. Runtime CLI resolution and `@vercel/nft` tracing package Circle CLI dependencies.                             |
| Public readiness        | Two real analyses completed. Saved-result replay and a second analysis from remaining credits passed; a separate live isolation test passed. |

This is a working prototype with a verified live payment-and-analysis path, not a production-maturity claim. See the [sanitized evidence](public/proofs/2026-09-10.json) and [verification qualifications](../../docs/ethonline-continuity.md#evidence-status). No user documents, model results, signatures, session cookies, or credentials appear in the evidence.

## Request lifecycle

1. The browser creates a signed 24-hour session and submits plain text with a UUID request key.
2. PostgreSQL deduplicates the request, applies quotas, and allocates a non-returnable `$0.40` demo-budget hold.
3. Vercel Workflow starts a durable run with the job ID. PostgreSQL grants one global execution claim, so the deployment performs one paid agent run at a time.
4. The OpenAI Agents SDK agent checks the visitor's product-credit balance and quote.
5. If the balance cannot cover the quote, the server constrains a Circle CLI payment to the stored service URL, Arc Testnet, the configured wallet, seller, and maximum amount.
6. Resvary reserves product credits. The service calls the selected analysis model, saves the result and measured usage, then commits the charge with stable idempotency keys.
7. The browser polls the job and can replay the saved result without another provider call.
8. A supervisor reconciles recoverable database state and clears document text and result text after 24 hours.

The demo uses two separate accounting controls:

- The PostgreSQL demo budget allocates `$0.40` for each accepted job and does not return unused allocation.
- The Resvary product-credit reservation charges measured service usage and releases unused reserved credits when the commit succeeds.

## Identity boundary

Circle exposes two addresses in this flow:

- `AGENT_DEMO_WALLET` identifies the Circle Agent Wallet smart contract account (SCA) used by the CLI.
- `AGENT_DEMO_PAYER` identifies that wallet's Gateway backing externally owned account (EOA). Gateway payment authorizations use this address.

`AGENT_DEMO_SELLER` must differ from `AGENT_DEMO_PAYER`. The deployed wallet SCA also has its own address. Readiness checks require the configured SCA to exist in the Circle Agent Wallet session and require Gateway to report the configured EOA as its backing address. Do not substitute the SCA for the backing EOA in payment validation.

## Local validation

Use Node.js 24 and a disposable PostgreSQL database whose name ends in `_test`. The integration suite clears the demo tables in that database.

From the repository root:

```sh
npm ci --ignore-scripts
npm run build:core
npm test --workspace @resvary/circle
npm test --workspace @resvary/agent-demo
```

Supply `TEST_DATABASE_URL` to run the PostgreSQL integration tests. The browser harness starts fixture services on `127.0.0.1:3100` and makes no external AI or payment request.

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres:PASSWORD@127.0.0.1:5432/resvary_agent_test'
npm test --workspace @resvary/agent-demo
npm run build --workspace @resvary/agent-demo
$env:AGENT_DEMO_TEST_EXECUTION_MODE='workflow'
npm run test:e2e --workspace @resvary/agent-demo
Remove-Item Env:\AGENT_DEMO_TEST_EXECUTION_MODE
```

Install Playwright Chromium if the runner reports that it is missing: `npx playwright install chromium`. For manual fixture inspection, run `node scripts/test-server.mjs` from this directory with `TEST_DATABASE_URL` set. Keep that harness on loopback.

The latest source verification passed 43 agent-demo tests, 17 nanopayment and credit-gate tests, and the compiled Workflow browser E2E. These checks use deterministic AI and payment fixtures; the separate live evidence records genuine Circle and Nous calls.

## Vercel configuration

Set the Vercel project root to `apps/agent-demo`. `vercel.json` selects `fra1`, gives the API and Workflow step routes a 300-second maximum duration, and builds the monorepo packages before the app. When deploying from the repository root, also pass `--regions fra1` and verify the deployed function region. `next.config.ts` installs the Workflow routes with `withWorkflow` and uses `@vercel/nft` to trace Circle CLI dependencies for the target operating system. The payment code resolves the CLI from the deployed Node runtime instead of asking Turbopack to bundle its executable path.

The application expects these server-side variables. Store secret values as Vercel Sensitive environment variables and never add them to Git.

| Variable                         | Purpose                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | Managed Neon PostgreSQL connection string                                                     |
| `AGENT_DEMO_ORIGIN`              | Exact HTTPS production origin                                                                 |
| `AGENT_DEMO_SECRET`              | HMAC secret for visitor sessions and internal payment tokens                                  |
| `CRON_SECRET`                    | Bearer secret for `/api/internal/maintenance`                                                 |
| `AGENT_DEMO_SELLER`              | Arc Testnet seller address                                                                    |
| `AGENT_DEMO_WALLET`              | Circle Agent Wallet SCA                                                                       |
| `AGENT_DEMO_PAYER`               | Gateway backing EOA                                                                           |
| `AGENT_DEMO_EXECUTION_MODE`      | Must equal `workflow` on Vercel                                                               |
| `AGENT_DEMO_TEST_MODE`           | Must equal `false` in production                                                              |
| `AGENT_DEMO_ACCEPTING`           | Controls new job admission                                                                    |
| `AGENT_DEMO_INITIAL_SPEND_UNITS` | Prior conservative provider-call holds in micro-USD, applied when the budget row first exists |
| `AGENT_DEMO_AGENT_PROVIDER`      | `nous` for the selected deployment                                                            |
| `AGENT_DEMO_AGENT_MODEL`         | `qwen/qwen3.8-flash`                                                                          |
| `AGENT_DEMO_ANALYSIS_PROVIDER`   | `nous` for the selected deployment                                                            |
| `AGENT_DEMO_ANALYSIS_MODEL`      | `openai/gpt-4.1-mini`                                                                         |
| `NOUS_API_KEY`                   | Nous API credential for both selected models                                                  |
| `CIRCLE_AGENT_SESSION_BUNDLE`    | Encrypted Testnet Agent Wallet session snapshot                                               |
| `CIRCLE_SESSION_ENCRYPTION_KEY`  | Separate AES-256-GCM key for the snapshot                                                     |

`scripts/sync-vercel-env.mjs` reads the ignored local configuration, checks that the linked project name is `resvary-agent-demo`, and streams values to the Vercel CLI through child-process stdin. It does not put secret values in command arguments or logs.

## Circle session handling

Run Circle CLI `1.0.0` login on an operator machine, then use `scripts/export-circle-session.ts`. The exporter selects the Testnet Agent Wallet slot, encrypts it with AES-256-GCM, and writes two values to the ignored `.env.circle-session.local` file. Each Vercel invocation decrypts the bundle into a new mode-`0700` directory under the platform temporary directory, writes credential files with mode `0600`, gives that directory to the Circle child process, and removes it in `finally`.

The current exported session expires on October 7, 2026. Treat that date as the expiry of this snapshot, not a promised session lifetime. Check the exact stored timestamp and Circle readiness before a production run. The CLI does not refresh the snapshot inside Vercel, so an operator must log in and export a new bundle before expiry.

## Limits and cost controls

- The API accepts plain text from 1 through 12,288 UTF-8 bytes. The service output cap is 1,024 tokens. The agent gets at most eight turns, 512 output tokens per turn, serialized tool calls, and a 16,000-byte provider request cap.
- Each signed session can create three jobs. Each IP hash can create ten jobs per UTC day. Replaying a known request key does not consume another allowance.
- The demo budget ceiling is `$10.00`, represented as `10,000,000` micro-USD. Provider probes created `19,390` micro-USD (`$0.019390`) of conservative pre-call holds. The provider reported `$0.00083109` in total probe spend. Record the holds, not the reported bill, in `AGENT_DEMO_INITIAL_SPEND_UNITS` before the first migration of a fresh database.
- Each accepted job allocates `400,000` micro-USD (`$0.40`) and the application never returns that allocation. With the recorded probe holds, a fresh budget can admit at most 24 jobs. This limit controls exposure; it does not report a provider invoice total.
- Product credits use `$2` per million input tokens and `$8` per million output tokens. The receipt reports this product charge, not the Nous invoice.
- The Circle payment policy rejects a request above `50,000` Gateway units and passes the stored funding amount again as the CLI `--max-amount` value.
- Readiness requires a valid Testnet session, the configured Agent Wallet SCA, the expected backing EOA, and at least `0.05` Testnet Gateway USDC.

## Recovery rules

PostgreSQL owns the execution claim. `agent_demo.executor` contains one global owner, and `agent_demo.jobs.execution_token` prevents another Workflow delivery from repeating the agent or provider call. A 90-second dispatch lease permits another Workflow enqueue if Vercel acknowledged the start but the app could not save the run ID; the database execution claim still blocks duplicate paid work.

The execution step has zero Workflow retries. Database-only metadata, reconciliation, and cleanup steps can retry after transient database failures. A supervisor runs beside the paid step, checks state after five-minute intervals, and marks an execution stale after ten minutes.

The service saves provider output before `commitUsage`. A `result_saved` job can finish through the same usage event and commit idempotency keys without another model call. A confirmed provider rejection releases the product-credit reservation. An unknown payment or provider outcome moves the job to `review_required`, preserves the evidence, and blocks automatic repayment or provider replay.

The payment endpoint stores the first authorization's hash, nonce, and validity deadline before contacting the facilitator. It does not store the signature. A later delivery returns an existing settled funding transaction or refuses a second settlement attempt. An operator must reconcile an unknown payment with Circle and the ledger before changing state.

Circle CLI `1.0.0` rewrites the authorization window to 30 days. The demo sets the adapter's `authorizationValiditySeconds` to match; strict requirement comparison and the funding-intent expiry remain unchanged. A successful facilitator response permits the credit grant before Gateway's later onchain batch. A ledger funding status of `settled` does not prove batch finality.

## Privacy and security

- Workflow receives opaque job IDs and timing/state values. PostgreSQL stores the submitted document and result.
- The application clears document and result columns after the 24-hour expiry. It retains ledger identifiers, events, quota counters, usage, and receipts. Database backups may retain older content until their own retention window ends.
- The app sets `store:false` for model calls and disables Agents SDK tracing. Provider-side retention remains subject to the provider's terms.
- The agent receives four fixed tools and no shell. The server fixes addresses, network, service URL, payment amount, provider profiles, and request limits.
- The public API derives the visitor account from an HMAC-signed, HttpOnly, `SameSite=Strict` cookie and checks the request origin for mutations.

## Known limitations

- Circle CLI cannot join the ordinary Turbopack module bundle because its dependency path includes native/non-ECMAScript assets. The implemented boundary resolves the CLI from the Node runtime and uses `@vercel/nft` to trace its target-OS dependency set. Local and Linux Vercel builds pass with this design.
- Two live jobs verified the payment-and-analysis path, but sustained traffic, real 24-hour cleanup, and Gateway batch onchain confirmation have not been observed. The first full live browser test reached its final isolation assertion too early; an explicit session wait fixes that test race, and a separate read-only production isolation test passed.
- The Hyperbolic credential probe returned HTTP 401. The deployment uses Nous, and no documentation should describe Hyperbolic as verified.
- Vercel Workflow provides durable orchestration, but an external call can finish while its response or following database write disappears. The demo stops those cases for operator review and makes no exactly-once claim about AI providers or Circle settlement.
- `vercel.json` does not register a periodic maintenance cron. Each started Workflow schedules its own 24-hour expiry. Operators must invoke the authenticated maintenance route to recover abandoned dispatches and clean expired rows whose Workflow never started.
- Circle CLI `1.0.0` brings unresolved transitive `npm audit --omit=dev` advisories involving `ws`, `toml`, `uuid`, and `stream-json`. The application confines the CLI to fixed child-process commands and a private temporary home, but that boundary does not fix upstream packages.
- The Neon free-plan limits and Vercel platform limits can throttle or suspend work. The application surfaces failed readiness and pauses new jobs; operators still need live platform monitoring.

See the [architecture](../../docs/agent-demo-architecture.md), [Vercel runbook](../../docs/agent-demo-vercel-runbook.md), and [ETHOnline continuity disclosure](../../docs/ethonline-continuity.md).
