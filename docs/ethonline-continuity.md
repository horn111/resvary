# ETHOnline continuity disclosure

## Baseline

- Disclosed continuity baseline: `1372d2c0dcba8ea1cd25736848d5ec22a3e34fbf`.
- Start of the Agent Stack implementation: `53f59dacc86f5300a68e29ceff7b7751af06c096` on September 8, 2026.
- The commits between those points contain earlier Resvary 1.0 work and do not count as the new Agent Stack integration.

The baseline already contained the Resvary credit ledger, pricing, PostgreSQL adapter, Circle Gateway funding adapter, and Operator Console. Arc served as the reference settlement network for external funding. The ledger supported multiple payment rails before the agent demo.

## New implementation

The Agent Stack work adds:

- `createGatewayCreditGate` in `@resvary/circle`;
- `apps/agent-demo`, a document-purchase agent built with the OpenAI Agents SDK;
- a separate paid document-analysis service and bounded provider adapter;
- a Circle Agent Wallet CLI payment constrained to Arc Testnet, fixed wallet identities, a fixed service URL, and a maximum amount;
- durable jobs, result-before-commit recovery, authorization fingerprints, session isolation, quotas, and persistent AI budget allocation;
- a Vercel deployment path using Next.js, Vercel Workflow `4.8.8`, and managed Neon PostgreSQL;
- a single global database execution claim, an independent supervisor, database-only recovery, and 24-hour content cleanup;
- fixture integration and browser tests, a private encrypted Circle session export, and a sanitized live-proof exporter.

Use this command after the implementation lands in one Git history:

```sh
git diff 53f59dacc86f5300a68e29ceff7b7751af06c096 -- apps/agent-demo packages/circle docs/agent-demo-architecture.md docs/agent-demo-vercel-runbook.md docs/ethonline-continuity.md
```

Review the complete diff for lockfile, build-context, and Vercel configuration changes.

## Production configuration

The dedicated Vercel project is `resvary-agent-demo`, and <https://agent.resvary.xyz> is the canonical interactive origin on a `READY` Linux production deployment. The database uses managed Neon PostgreSQL on the free plan in `fra1`, and migrations passed. The deployment resolves Circle CLI from the Node runtime and uses `@vercel/nft` to trace its target-OS dependencies, including native files outside the ordinary Turbopack module bundle.

The selected provider configuration uses Nous for both roles:

- buying agent: `qwen/qwen3.8-flash`;
- paid analysis service: `openai/gpt-4.1-mini`.

The agent still runs through `@openai/agents`. The application uses `OpenAIProvider` with the OpenAI-compatible Nous transport. A Hyperbolic key probe returned HTTP 401, so Hyperbolic has no verified role in the production demo.

Circle uses separate wallet identities. `AGENT_DEMO_WALLET` identifies the Agent Wallet SCA, while `AGENT_DEMO_PAYER` identifies its Gateway backing EOA. The EOA signs the Gateway authorization. The application checks the relationship during readiness and validates the EOA on payment.

The Vercel session snapshot contains only the Circle CLI Testnet Agent Wallet slot and accepted-terms record. The operator encrypts it with AES-256-GCM and uploads the encrypted value and key as separate Sensitive variables. Each function call decrypts it under a private temporary directory and removes that directory after the CLI exits.

The current snapshot expires on October 7, 2026. That date describes the exported session in use and does not promise a fixed seven-day duration. Operators must check the exact private timestamp and rotate the snapshot before expiry.

## Budget disclosure

The public demo has a `$10.00` provider budget. Provider probes created `19,390` micro-USD (`$0.019390`) of conservative pre-call holds, while the provider reported `$0.00083109` in total probe spend. Each accepted job allocates a fixed, non-returnable `400,000` micro-USD (`$0.40`) in PostgreSQL before an external call. With the probe holds recorded in a fresh database, the budget accepts at most 24 jobs.

This budget allocation differs from the visitor-facing product-credit charge. Resvary reserves the service quote at `$2` per million input tokens and `$8` per million output tokens, commits measured usage, and releases unused product credits. The receipt does not claim to reproduce the Nous invoice.

## Evidence status

Source validation passed 43 agent-demo tests, 17 nanopayment and credit-gate tests, and the compiled Workflow browser E2E. These source tests use deterministic-provider and simulated-facilitator paths.

Separate production verification used real Circle Testnet and Nous calls. Managed Neon migrations, the Linux deployment, and operator and deployed-cloud readiness passed. The [sanitized evidence record](../apps/agent-demo/public/proofs/2026-09-10.json) contains:

- job `8729f212-e29b-4e5e-8d9c-948423e67781`: one accepted 0.02 Testnet USDC Gateway payment, one funding grant, 0.010276 reserved, 0.001268 charged, and 0.009008 released;
- replay of that job with the same result, receipt, events, and balance, without another paid call;
- job `9c4ebb56-0d89-410b-a136-09dacad68375`: another real analysis using remaining credits, 0.000988 charged, and no new payment;
- final session credits of 0.017744 and matching ledger receipt conservation;
- a separate production browser test confirming that a new session sees zero credits and cannot read the first session's job.

The full live browser test passed its payment, analysis, replay, and leftover-credit checks, then failed because its final isolation check read status before the new session finished initialization. The test now waits for initialization. A separate read-only isolation test passed; the complete paid test has not been rerun just to replace that earlier result. Three private screenshots capture the successful paid flow before the final assertion.

An earlier live attempt stopped before Gateway verification because Circle CLI `1.0.0` changed the authorization window to 30 days. Two SDK regression tests cover strict rejection and the explicit compatibility setting. The operator confirmed no Gateway transfer and no ledger funding for that failed attempt; its budget hold remains allocated. At 22:39 UTC on September 9, remaining budget capacity was `$8.780610`, after probe holds and three job holds. This is not a provider invoice total.

Gateway transfer `79c04414-c4ec-4ccd-95b8-24df4e8b6e3b` independently reported the expected 20,000 USDC base units, payer, seller, and Arc Testnet network. Its status was `received` with no transaction hash. Gateway accepts nanopayments before [batch settlement onchain](https://developers.circle.com/gateway/nanopayments/concepts/batched-settlement); the successful facilitator response and Resvary credit grant do not prove final batch confirmation. Real 24-hour cleanup and sustained-load behavior also remain unverified.

The proof exporter rejects fixture runs and omits user text, results, signatures, session data, and credentials. Describe <https://agent.resvary.xyz> as a working prototype with a verified live payment-and-analysis path. Do not claim production maturity or exactly-once execution by an external provider.

Keep application-form prose, submission drafts, campaign material, and recording scripts outside the Git worktree. The user records the video and submits the final form. The September 12 target remains internal; the operator must confirm the exact ETHGlobal deadline in the official dashboard.
