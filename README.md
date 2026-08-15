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

The credit engine is payment-rail agnostic. The existing Arc Testnet invoice, memo proof, payment receipt, and signed webhook modules remain available and now serve as an optional USDC funding adapter.

## Why Resvary

AI costs are known only after a model or tool finishes. A single `balance -= cost` update is not enough when requests retry, overlap, fail, or report usage late.

Resvary provides:

- USD-denominated credits with six-decimal integer arithmetic;
- multi-dimensional prices for tokens, seconds, images, jobs, or tool calls;
- atomic `reserve → commit/release` operations;
- idempotency for grants, reservations, charges, and funding confirmations;
- immutable ledger entries and per-charge usage receipts;
- transactional outbox events using the existing `x-resvary-signature` format;
- in-memory and SQLite stores;
- optional Arc Testnet USDC top-ups;
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

## Demo

Requires Node.js 24 because the persistent demo uses the built-in `node:sqlite` module.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The default flow is deterministic and does not require an AI API key. Optional OpenAI-compatible mode uses:

```dotenv
RESVARY_AI_BASE_URL=https://api.openai.com/v1
RESVARY_AI_API_KEY=
RESVARY_AI_MODEL=
```

The old payment operations APIs remain under `/api/receipts`, `/api/receipts/proof`, and `/api/webhook-inbox`.

## Modules

| Import                      | Responsibility                                                              |
| --------------------------- | --------------------------------------------------------------------------- |
| `@resvary/sdk/credits`     | Accounts, grants, reservations, usage receipts, ledger, idempotency, outbox |
| `@resvary/sdk/pricing`     | Meters, immutable price versions, integer usage rating                      |
| `@resvary/sdk/funding/arc` | Arc invoice/payment receipt to credit grant adapter                         |
| `@resvary/sqlite`          | Persistent credit and payment receipt stores                                |
| `@resvary/sdk/receipts`    | Stablecoin invoices, proofs, payment receipts, signed webhooks              |
| `@resvary/sdk/middleware`  | Compatible legacy x402 Express and Next.js paywalls                         |

`UsageMeter` and `createBillingPlan` remain available for compatibility but are deprecated. New integrations should use the credit ledger and versioned pricing.

## Guarantees and limits

- Money is never calculated with JavaScript floating point in the new engine.
- A project/customer account cannot have a negative available balance.
- SQLite mutations use `BEGIN IMMEDIATE` and store the balance change, receipt, idempotency result, and outbox event together.
- Credits are closed-loop product credits. Resvary does not support user-to-user transfer, cash-out, redemption, custody, tax invoices, subscriptions, or marketplace balances.
- SQLite is intended for local, single-node, and design-partner deployments. Postgres and a self-hosted HTTP service are later milestones.
- Arc funding is Testnet-first and is not a production money-flow claim.

## Documentation

- [Prepaid credits](docs/prepaid-credits.md)
- [Usage rating](docs/usage-rating.md)
- [Architecture](docs/architecture.md)
- [SQLite persistence](docs/persistence.md)
- [Arc credit funding](docs/arc-credit-funding.md)
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
