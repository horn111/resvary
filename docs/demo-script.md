# Demo Script

## Setup

The persistent demo requires Node.js 24.

```bash
npm install
$env:RESVARY_DEMO_ADMIN_TOKEN = 'replace-with-a-long-random-token'
$env:RESVARY_WEBHOOK_SECRET = 'replace-with-a-different-long-random-token'
npm run dev --workspace=@resvary/demo -- --port 3004
```

Open [http://localhost:3004](http://localhost:3004) and enter the token in **Demo admin token**. No wallet or AI key is required for the deterministic flow. Every mutating demo request fails closed without the server-configured token.

## Shared credit lifecycle

1. Click **Grant $5**.
2. Click **Run simulated AI**. Resvary reserves the maximum cost, commits actual token usage, and releases the remainder.
3. Inspect the reservation, usage receipt, ledger entries, and outbox events.
4. Click **Replay same request**. The stored result returns without another charge.
5. Click **Simulate failure**. The full reservation is released.

## Direct Arc funding

Select **Arc USDC**.

- **Simulate Arc $2** demonstrates the funding-to-credit connection locally.
- For a real proof, set `RESVARY_ARC_FUNDING_RECIPIENT`, create a live request, send the Memo-wrapped transfer from a funded Arc Testnet EOA, and paste its transaction hash.
- Submit the same hash again. The balance and grant count must remain unchanged.

The live proof checks Memo and transfer evidence through Arc RPC. The demo never asks for or stores an EOA private key.

## Gateway Nanopayment funding

Select **Gateway Nanopayment**.

1. Click **Create Gateway request**.
2. Inspect the x402 v2 requirements and funding intent.
3. Click **Verify, settle, and credit**.
4. Inspect the external reference, funding transaction, credit grant, and account balance.
5. Click **Replay authorization**. No second grant is created.

The demo uses a deterministic facilitator fixture so it works without a buyer key. The release evidence flow must use Circle's Testnet facilitator and the official `@circle-fin/x402-batching` buyer. The UI labels the fixture and does not present it as a live settlement.
