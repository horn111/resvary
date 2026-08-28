<p align="center">
  <img src="assets/brand/resvary-x-avatar.png" alt="Resvary logo" width="112" />
</p>

<h1 align="center">Resvary</h1>

<p align="center"><strong>Open-source prepaid credits and usage billing for AI products.</strong></p>

Resvary gives AI applications a durable balance ledger and a safe request lifecycle:

```text
grant or top up credits
→ reserve the maximum cost
→ execute the AI job
→ charge actual usage
→ release the remainder
→ issue an auditable usage receipt
```

The credit engine is payment-rail agnostic. Resvary 0.5 adds Postgres persistence and durable webhook delivery to the two Circle-native Testnet top-up paths introduced in 0.4.

## Why Resvary

AI costs are known only after a model or tool finishes. A single `balance -= cost` update is not enough when requests retry, overlap, fail, or report usage late.

Resvary provides:

- USD-denominated credits with six-decimal integer arithmetic;
- multi-dimensional prices for tokens, seconds, images, jobs, or tool calls;
- atomic `reserve → commit/release` operations;
- idempotency for grants, reservations, charges, and funding confirmations;
- immutable ledger entries and per-charge usage receipts;
- transactional outbox events using the existing `x-resvary-signature` format;
- in-memory, SQLite, and Postgres stores;
- a lease-based outbox worker with retry and dead-letter recovery;
- direct Arc Testnet USDC top-ups with durable watcher recovery;
- Circle Gateway Nanopayment top-ups through the official batching facilitator;
- an interactive Next.js demo and Express/Next.js starter generator.

## Quickstart

```bash
npm install @resvary/sdk @resvary/sqlite
```

```typescript
import { CreditLedger } from '@resvary/sdk/credits';
import { createSqliteCreditStore } from '@resvary/sqlite';

const credits = new CreditLedger({
  projectId: 'my_ai_product',
  store: createSqliteCreditStore({
    path: '.resvary/resvary.sqlite',
  }),
});

const meter = await credits.registerMeter({
  key: 'llm_tokens',
  dimensions: ['input_tokens', 'output_tokens'],
  idempotencyKey: 'meter-v1',
});

const price = await credits.createPriceVersion({
  meterKey: meter.key,
  rates: [
    { dimension: 'input_tokens', unitSize: '1000', amount: '0.002' },
    { dimension: 'output_tokens', unitSize: '1000', amount: '0.008' },
  ],
  idempotencyKey: 'price-v1',
});

await credits.grantCredits({
  customerId: 'customer_123',
  amount: '5',
  idempotencyKey: 'signup-credit:customer_123',
});

const result = await credits.runMetered(
  {
    customerId: 'customer_123',
    priceId: price.id,
    estimatedUsage: { input_tokens: '2000', output_tokens: '1000' },
    idempotencyKey: 'request_abc',
  },
  async () => {
    const completion = await callYourModel();
    return {
      value: completion,
      actualUsage: {
        input_tokens: String(completion.usage.inputTokens),
        output_tokens: String(completion.usage.outputTokens),
      },
      usageEventId: completion.id,
    };
  },
);

console.log(result.receipt.amount);
console.log(result.receipt.releasedAmount);
console.log(result.balance.availableAmount);
```

If the provider throws, `runMetered` releases the full reservation. If provider execution succeeds but commit fails, the reservation stays open so the same operation can be retried safely.

For a multi-process deployment, install Postgres persistence and apply migrations before the application starts:

```bash
npm install @resvary/postgres @resvary/worker
DATABASE_URL=postgres://... npx resvary-postgres migrate
```

See the production persistence guide before moving an existing SQLite database.

## Circle-native Testnet funding

Install the optional adapter when credits should be funded by direct Arc USDC or a Circle Gateway Nanopayment:

```bash
npm install @resvary/circle
```

```typescript
import { GatewayNanopaymentFunding } from '@resvary/circle';

const funding = new GatewayNanopaymentFunding({
  ledger: credits,
  sellerAddress: '0x1111111111111111111111111111111111111111',
});

const request = await funding.createFundingRequest({
  customerId: 'customer_123',
  amount: '5',
  idempotencyKey: 'topup_123',
});
```

Credits are created only after the official Circle facilitator verifies and settles the authorization. See the direct Arc and Gateway guides for the complete server flows.

## Demo

Requires Node.js 24 because the persistent demo uses the built-in `node:sqlite` module.

```bash
npm install
npm run dev
```

Set a local admin token, start the demo, and enter the same token in the UI. Mutating demo actions fail closed when the token is missing.

```dotenv
RESVARY_DEMO_ADMIN_TOKEN=replace-with-a-long-random-token
RESVARY_WEBHOOK_SECRET=replace-with-a-different-long-random-token
```

Open [http://localhost:3000](http://localhost:3000). The flow is deterministic and never sends a request to an external AI provider.

The old payment operations APIs remain under `/api/receipts`, `/api/receipts/proof`, and `/api/webhook-inbox`. Receipt signing and webhook ingestion stay disabled until `RESVARY_WEBHOOK_SECRET` is configured.

## Modules

| Import                     | Responsibility                                                              |
| -------------------------- | --------------------------------------------------------------------------- |
| `@resvary/sdk/credits`     | Accounts, grants, reservations, usage receipts, ledger, idempotency, outbox |
| `@resvary/sdk/pricing`     | Meters, immutable price versions, integer usage rating                      |
| `@resvary/sdk/funding/arc` | Direct Arc invoice/payment receipt to credit grant adapter                  |
| `@resvary/sdk/funding`     | Durable Arc funding worker                                                  |
| `@resvary/circle`          | Circle Gateway Nanopayments and HTTP handlers                               |
| `@resvary/sqlite`          | Persistent credit and payment receipt stores                                |
| `@resvary/postgres`        | Multi-process stores, schema migrations, health and SQLite import           |
| `@resvary/worker`          | Lease-based signed webhook delivery, retry, dead letter and worker CLI      |
| `@resvary/sdk/receipts`    | Stablecoin invoices, proofs, payment receipts, signed webhooks              |
| `@resvary/sdk/middleware`  | Compatible legacy x402 Express and Next.js paywalls                         |

`UsageMeter` and `createBillingPlan` remain available for compatibility but are deprecated. New integrations should use the credit ledger and versioned pricing.

## Guarantees and limits

- Money is never calculated with JavaScript floating point in the new engine.
- A project/customer account cannot have a negative available balance.
- SQLite mutations use `BEGIN IMMEDIATE` and store the balance change, receipt, idempotency result, and outbox event together.
- Credits are closed-loop product credits. Resvary does not support user-to-user transfer, cash-out, redemption, custody, tax invoices, subscriptions, or marketplace balances.
- SQLite remains a local and single-node backend. Postgres 16–18 is the recommended backend for multi-process deployments.
- Outbox delivery is at least once. Webhook consumers must deduplicate by `x-resvary-event-id`.
- Postgres migrations are explicit deployment steps and never run when a store is constructed.
- Direct Arc and Gateway funding are Testnet-only and are not production money-flow claims.
- Resvary stores authorization hashes and normalized evidence, never buyer private keys or full Gateway signatures.

## Documentation

- [Prepaid credits](docs/prepaid-credits.md)
- [Usage rating](docs/usage-rating.md)
- [Architecture](docs/architecture.md)
- [Persistence](docs/persistence.md)
- [Production persistence deployment](docs/production-persistence.md)
- [Migrate from 0.4 to 0.5](docs/migration-0.5.md)
- [Direct Arc credit funding](docs/arc-credit-funding.md)
- [Circle Gateway funding](docs/circle-gateway-funding.md)
- [Funding recovery](docs/funding-recovery.md)
- [Migrate from 0.3 to 0.4](docs/migration-0.4.md)
- [Release evidence checklist](docs/evidence/circle-funding-proof.md)
- [Migration from legacy billing](docs/migration-to-credits.md)
- [Security and legal model](docs/credit-security-model.md)
- [Demo walkthrough](docs/demo-script.md)
- [Roadmap](ROADMAP.md)

## Development

```bash
npm install
npm run typecheck
npm run test --workspaces --if-present -- --reporter=dot
npm run build
```

The project is Apache-2.0 licensed. See [SECURITY.md](SECURITY.md) before reporting a vulnerability.
