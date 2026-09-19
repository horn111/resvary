# Resvary AI Credits Demo

Interactive Next.js demo for:

```text
$5 grant → reserve → simulated AI usage → commit → release → usage receipt
```

It also demonstrates graduated token tiers, package-priced images, idempotent replay, provider failure, persistent ledger state, transactional outbox events, and compatible webhook signatures.

```bash
npm run dev --workspace=apps/demo
```

Node.js 24+ is required. Set `RESVARY_DEMO_ADMIN_TOKEN` before startup and enter it in the UI; credit, proof-watch, replay, and live Gateway mutations require the token. Set a separate random `RESVARY_WEBHOOK_SECRET` to enable the signed receipt/webhook demo. The simulation needs no AI-provider key and does not call an external provider.

Local development uses SQLite at `.resvary/demo.sqlite` unless `RESVARY_CREDITS_DB_PATH` overrides it. Multi-instance and serverless deployments must set `DATABASE_URL` and apply the PostgreSQL migrations before startup:

```bash
DATABASE_URL=postgres://... npx resvary-postgres migrate
```

The API reports only `PostgreSQL` as its persistence label and never returns the connection string.

Set `RESVARY_ARC_FUNDING_RECIPIENT` to a public Arc Testnet address to enable the real funding proof. The demo creates a funding intent and Memo contract calldata. After a funded EOA sends the transaction, paste its hash into the demo. Resvary verifies the Memo event and USDC transfer through Arc RPC before it grants credits. The app does not request or store the EOA private key.

The standalone Arc payment proof and webhook routes remain available alongside the credit funding flow.
