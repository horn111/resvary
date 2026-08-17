# Resvary AI Credits Demo

Interactive Next.js demo for:

```text
$5 grant → reserve → simulated AI usage → commit → release → usage receipt
```

It also demonstrates idempotent replay, provider failure, SQLite restart persistence, ledger entries, transactional outbox events, and compatible webhook signatures.

```bash
npm run dev --workspace=apps/demo
```

Node.js 24+ is required. The default simulation needs no external key. Set `RESVARY_AI_API_KEY`, `RESVARY_AI_MODEL`, and optionally `RESVARY_AI_BASE_URL` for the live OpenAI-compatible button.

Set `RESVARY_ARC_FUNDING_RECIPIENT` to a public Arc Testnet address to enable the real funding proof. The demo creates a funding intent and Memo contract calldata. After a funded EOA sends the transaction, paste its hash into the demo. Resvary verifies the Memo event and USDC transfer through Arc RPC before it grants credits. The app does not request or store the EOA private key.

The standalone Arc payment proof and webhook routes remain available alongside the credit funding flow.
