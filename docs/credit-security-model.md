# Credit Security and Legal Model

## Technical controls

- Use unpredictable server-generated application customer IDs.
- Never accept `projectId`, price IDs, amounts, or idempotency scope directly from an untrusted client without authorization.
- Create meters, tier boundaries, package sizes, and immutable price versions only through trusted administrative paths. Never accept pricing components from an end-user request.
- Treat `CreditLedger` as the project-scoped tenant boundary. Raw `CreditStore` access, including `ledger.store`, is a trusted administrative primitive and must never be exposed to untrusted request data.
- Keep grants and adjustments behind an admin or verified funding path.
- Authorize policy creation and application separately. Check promotion eligibility, segments, and coupons before `claimPromotion`; Resvary only enforces one claim per customer and immutable policy version.
- Run expiry sweeps from trusted maintenance infrastructure. There is no built-in scheduler or new worker mode.
- Treat provider response IDs as untrusted until they are scoped to the correct project and request.
- Keep metadata free of API keys, prompts containing sensitive data, and unnecessary personal information.
- Protect SQLite files and webhook secrets with operating-system permissions and backups.
- Deliver the transactional outbox from a trusted worker and mark events delivered only after the receiver accepts them.
- Rotate webhook secrets using an overlap window at the application layer.

SQLite supports local and single-node deployments. Multi-process deployments should use the Postgres adapter with explicit migrations, serializable transactions, and at least one outbox worker. Resvary does not provide a hosted control plane, production SLA, or compliance certification.

Promotion expiry is enforced inside balance transactions. An open reservation keeps its allocated units so already-authorized work can commit. Any expired remainder burns on release and never returns to available credits.

## Funding-specific controls

Automatic x402 buyers must configure a fail-closed `paymentPolicy` with a per-request limit, a client-instance total budget, and an exact recipient allowlist. `BuyerClient` rejects `402` responses without that policy and binds the response to the requested origin by default.

Direct Arc funding re-fetches transaction evidence from Arc RPC before every credit grant, including crash recovery. Persisted invoices and receipts support recovery but are not trusted as payment authority without fresh proof verification.

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
