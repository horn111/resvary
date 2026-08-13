# Settlary AI Credits Demo

Interactive Next.js demo for:

```text
$5 grant → reserve → simulated AI usage → commit → release → usage receipt
```

It also demonstrates idempotent replay, provider failure, SQLite restart persistence, ledger entries, transactional outbox events, and compatible webhook signatures.

```bash
npm run dev --workspace=apps/demo
```

Node.js 24+ is required. The default simulation needs no external key. Set `SETTLARY_AI_API_KEY`, `SETTLARY_AI_MODEL`, and optionally `SETTLARY_AI_BASE_URL` for the live OpenAI-compatible button.

Legacy Arc payment proof and webhook routes remain available for the optional funding path.
