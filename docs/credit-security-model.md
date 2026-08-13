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

SQLite is an alpha local/single-node backend. Multi-process and production deployments should wait for the Postgres adapter or supply a `CreditStore` with equivalent transaction isolation.

## Legal product boundary

Settlary supplies billing software. It does not provide custody or operate a consumer wallet.

The intended credits are:

- usable only inside one merchant project;
- non-transferable between users;
- not redeemable or cashable out;
- not represented as stored money or an investment;
- subject to the merchant's own terms, refund policy, privacy notice, and tax treatment.

A `UsageReceipt` is an operational billing record, not a tax invoice. Arc Testnet activity is development data. Before offering mainnet funding, transferable value, multi-merchant balances, or redemption, obtain jurisdiction-specific legal advice.
