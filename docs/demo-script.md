# Demo Script

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No wallet or AI key is required.

## Walkthrough

1. Click **Grant $5.00**. Posted and available balances become `$5`.
2. Click **Run simulated AI**. Resvary reserves the maximum token cost, executes deterministic simulated usage, charges the actual amount, and releases the remainder.
3. Inspect the reservation and usage receipt. The receipt includes input/output line items, actual charge, released amount, and before/after balance.
4. Inspect the immutable ledger and transactional outbox. The latest event includes an `x-resvary-signature`-compatible header.
5. Click **Replay same request**. The provider callback is not executed again and the balance does not change.
6. Click **Simulate failure**. The full reservation is released and posted credits remain unchanged.
7. Restart the development server. SQLite restores balances, receipts, reservations, ledger entries, and idempotency results.

## Optional live provider

Set `RESVARY_AI_API_KEY` and `RESVARY_AI_MODEL`; optionally set `RESVARY_AI_BASE_URL`. The UI then exposes **Run live provider**. The route expects an OpenAI-compatible chat completions response with prompt and completion token usage.

## Arc funding proof

Set `RESVARY_ARC_FUNDING_RECIPIENT` to a public Arc Testnet recipient address and restart the demo.

1. Click **Create live Arc request**.
2. Copy the Memo contract address and transaction calldata.
3. Send the transaction from a funded Arc Testnet EOA.
4. Paste the transaction hash into the demo and click **Verify and grant credits**.
5. Resvary verifies the Memo event, USDC transfer, recipient, amount, and memo ID through Arc RPC.
6. Inspect the linked funding transaction, credit grant, ledger entry, and Arcscan link.
7. Submit the same transaction hash again to confirm that the ledger does not create a second grant.

The demo never requests or stores the EOA private key. The standalone payment proof and webhook routes remain available at `/api/receipts` and related proof/inbox endpoints.
