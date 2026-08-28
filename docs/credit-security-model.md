# Credit Security and Legal Model

## Technical controls

- Use unpredictable server-generated application customer IDs.
- Never accept `projectId`, price IDs, amounts, or idempotency scope directly from an untrusted client without authorization.
- Keep grants and adjustments behind an admin or verified funding path.
- Treat provider response IDs as untrusted until they are scoped to the correct project and request.
- Keep metadata free of API keys, prompts containing sensitive data, and unnecessary personal information.
- Protect SQLite files and webhook secrets with operating-system permissions and backups.
- Deliver the transactional outbox from a trusted worker and mark events delivered only after the receiver accepts them.
- Rotate webhook secrets using an overlap window at the application layer.

SQLite supports local and single-node deployments. Multi-process deployments should use the Postgres adapter with explicit migrations, serializable transactions, and at least one outbox worker. Resvary does not provide a hosted control plane, production SLA, or compliance certification.

## Funding-specific controls

### Direct Arc

- Validate chain ID, Memo contract, Memo ID, calldata hash, sender, recipient, USDC amount, transaction status, and confirmation depth.
- Bound RPC ranges, persist cursors, and rescan a small overlap.
- Treat a saved payment receipt as the recovery boundary; retry the local grant with the same external payment ID.

### Circle Gateway

- Use the official batching facilitator for verify and settle.
- Match scheme, network, asset, exact amount, recipient, payer when configured, nonce, and expiry to a server-created funding intent.
- Persist only the normalized authorization hash and evidence fields. Never persist the full signature or a buyer private key.
- Grant credits only after `settle.success`.
- Route later disputes to `reconciliation_required`; do not edit ledger history or silently debit the customer.

## Legal product boundary

Resvary supplies billing software. It does not provide custody or operate a consumer wallet.

The intended credits are:

- usable only inside one merchant project;
- non-transferable between users;
- not redeemable or cashable out;
- not represented as stored money or an investment;
- subject to the merchant's own terms, refund policy, privacy notice, and tax treatment.

A `UsageReceipt` is an operational billing record, not a tax invoice. Arc Testnet activity is development data. Before offering mainnet funding, transferable value, multi-merchant balances, or redemption, obtain jurisdiction-specific legal advice.
