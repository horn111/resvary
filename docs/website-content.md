# Resvary Website Content Source of Truth

This file contains product facts and website copy. It does not prescribe layout, colors, typography, animation, or visual style.

All public website copy should be in English.

## 1. Product identity

**Product name:** Resvary

**Current version:** 0.3 alpha

**Primary category:** Prepaid credits and usage billing infrastructure for AI products

**Product type:** Open-source TypeScript developer infrastructure

**License:** Apache-2.0

**Primary audience:** Technical founders, backend engineers, and platform engineers building AI SaaS products, APIs, agents, generation tools, and batch jobs.

**Canonical one-liner:**

> Open-source prepaid credits and usage billing for AI products.

**Short description:**

> Resvary gives AI products a durable credit ledger and a safe way to authorize variable usage before a model, agent, or tool runs.

**Full description:**

> Resvary reserves the maximum cost before an AI operation, charges the actual usage after completion, releases the unused amount, and records an auditable usage receipt. The embedded TypeScript SDK handles credit balances, immutable prices, idempotency, reservations, ledger entries, receipts, and transactional outbox events.

**GitHub About description:**

> Open-source prepaid credits and usage billing for AI products. Reserve spend, charge actual usage, and issue auditable receipts.

## 2. Canonical links

- Website and live demo: https://resvary.vercel.app
- GitHub repository: https://github.com/horn111/resvary
- README: https://github.com/horn111/resvary#readme
- Getting started: https://github.com/horn111/resvary/blob/main/docs/getting-started.md
- Prepaid credits: https://github.com/horn111/resvary/blob/main/docs/prepaid-credits.md
- Usage rating: https://github.com/horn111/resvary/blob/main/docs/usage-rating.md
- Architecture: https://github.com/horn111/resvary/blob/main/docs/architecture.md
- Persistence: https://github.com/horn111/resvary/blob/main/docs/persistence.md
- Security and legal model: https://github.com/horn111/resvary/blob/main/docs/credit-security-model.md
- Arc credit funding: https://github.com/horn111/resvary/blob/main/docs/arc-credit-funding.md
- License: https://github.com/horn111/resvary/blob/main/LICENSE
- Security policy: https://github.com/horn111/resvary/blob/main/SECURITY.md
- Issues and feedback: https://github.com/horn111/resvary/issues

No public pricing, sales email, customer portal, hosted account signup, or npm package page should be linked until those destinations exist.

## 3. Navigation labels

- Product
- How it works
- Demo
- Use cases
- Docs
- GitHub

Primary navigation CTA:

> Explore the live demo

## 4. Homepage copy

### Status label

> Open source · 0.3 alpha

### Hero

**Headline:**

> Prepaid credits and usage billing for AI products

**Supporting copy:**

> Reserve a maximum cost before an AI job runs. Charge the actual usage when it finishes. Release the rest and give users an auditable receipt.

**Primary CTA:**

> Explore the live demo

Link: https://resvary.vercel.app

**Secondary CTA:**

> View the source on GitHub

Link: https://github.com/horn111/resvary

**Supporting line:**

> Apache-2.0 · TypeScript · Embedded SDK · SQLite alpha backend

### Problem section

**Heading:**

> AI usage has a timing problem

**Body:**

> Your product must decide whether a customer can start an AI request before the final cost exists. Tokens, seconds, images, and tool calls arrive after the provider finishes. A balance column cannot protect concurrent requests, recover from retries, release failed work, or explain a disputed charge.

> Resvary puts a transaction boundary around that moment. Your application authorizes a maximum amount first, then records the real charge after execution.

**Problem points:**

- Concurrent jobs can spend the same apparent balance.
- A retried request can create a duplicate charge.
- Failed jobs can leave credits locked without an explicit release.
- Mutable prices make old charges hard to explain.
- A balance snapshot cannot show why the number changed.

### Core flow

**Heading:**

> One lifecycle from authorization to receipt

**Step 1 title:** Fund the account

**Step 1 copy:**

> Grant product credits from your application or confirm an external funding payment.

**Step 2 title:** Reserve the maximum cost

**Step 2 copy:**

> Rate the estimated usage against an immutable price version and hold that amount before expensive work begins.

**Step 3 title:** Run the AI operation

**Step 3 copy:**

> Call a model, agent, generation pipeline, tool, or batch worker with your existing provider stack.

**Step 4 title:** Commit actual usage

**Step 4 copy:**

> Rate the provider's final usage, charge it once, and release the unused part of the reservation in the same transaction.

**Step 5 title:** Record the result

**Step 5 copy:**

> Store an immutable ledger entry, usage receipt, idempotency result, and outbox event for reconciliation.

**Compact flow label:**

> Fund → Reserve → Execute → Commit → Release → Receipt

### Primary benefits

**Section heading:**

> The billing boundary around every AI call

**Benefit 1 heading:** Authorize spend before execution

**Benefit 1 body:**

> Resvary checks available credits and creates an atomic reservation before your application starts provider work. Overlapping requests cannot reserve the same credits twice when the store supplies the required transaction isolation.

**Benefit 2 heading:** Charge once across retries

**Benefit 2 body:**

> Every mutating command requires an idempotency key. Replaying the same key and payload returns the original result. Reusing the key with different input raises a conflict.

**Benefit 3 heading:** Explain each balance change

**Benefit 3 body:**

> Immutable ledger entries and per-charge usage receipts record the price version, line items, amount charged, amount released, and balance after the operation.

**Benefit 4 heading:** Keep payment rails separate from usage

**Benefit 4 body:**

> The credit lifecycle does not depend on checkout, wallets, or an AI provider. Your application can fund the same ledger through manual grants, Arc USDC payments, or another adapter without changing usage accounting.

### Capability list

**Heading:**

> Included in the 0.3 alpha

- Closed-loop USD product credit accounts
- Six-decimal integer credit arithmetic
- Multi-dimensional usage meters
- Immutable price versions
- Estimated-usage reservations
- Actual-usage commit and release
- Expiring open reservations
- Persistent idempotency records
- Append-only ledger entries
- Per-charge usage receipts
- Manual grants and explicit adjustments
- Transactional outbox events
- Signed credit webhook payloads
- In-memory and SQLite stores
- Arc Testnet USDC funding adapter
- Next.js and Express starter generation
- Existing stablecoin receipt and x402 compatibility modules

### Usage types

**Heading:**

> Meter the units your product already receives

**Body:**

> A meter can rate one or more integer dimensions. Each immutable price version keeps old receipts tied to the rates used at the time of the charge.

**Examples:**

- LLM chat: input tokens and output tokens
- Image generation: images or compute seconds
- AI agents: tool calls, steps, or runtime
- Speech and video: seconds or minutes processed
- Batch jobs: items, pages, or completed jobs
- Developer APIs: requests or domain-specific units

**Current pricing scope:**

> The alpha supports linear multi-dimensional rates. Tiering, packages, subscriptions, monthly minimums, and allowances are outside the current scope.

### Code example

**Heading:**

> Wrap the provider call with a metered credit lifecycle

**Introduction:**

> `runMetered` reserves estimated usage, runs your provider callback, commits the actual usage, and returns the released amount and receipt.

```typescript
import { CreditLedger } from '@resvary/sdk/credits';
import { createSqliteCreditStore } from '@resvary/sqlite';

const credits = new CreditLedger({
  projectId: 'my_ai_product',
  store: createSqliteCreditStore({
    path: '.resvary/resvary.sqlite',
  }),
});

const result = await credits.runMetered(
  {
    customerId: 'customer_123',
    priceId: 'price_llm_v1',
    estimatedUsage: {
      input_tokens: '2000',
      output_tokens: '1000',
    },
    idempotencyKey: 'request_abc',
  },
  async () => {
    const completion = await callModel();

    return {
      value: completion,
      usageEventId: completion.id,
      actualUsage: {
        input_tokens: String(completion.usage.inputTokens),
        output_tokens: String(completion.usage.outputTokens),
      },
    };
  },
);

console.log(result.receipt.amount);
console.log(result.receipt.releasedAmount);
```

**Behavior note:**

> If the provider throws, `runMetered` releases the full reservation. If provider execution succeeds but the commit fails, the reservation stays open so your application can retry the same commit without giving away completed usage.

**Alpha installation note:**

> The packages currently live in the Resvary monorepo. Use the repository setup instructions until public package releases are available.

### Interactive demo

**Heading:**

> Inspect the full lifecycle in the demo

**Body:**

> The deterministic demo works without an AI API key. Grant credits, run a simulated AI request, replay its idempotency key, trigger a provider failure, and inspect every stored result.

**Demo actions:**

- Grant $5 in development credits
- Run a simulated AI operation
- Replay the same request
- Simulate provider failure
- Simulate an Arc Testnet funding confirmation

**Data exposed by the demo:**

- Posted, reserved, and available balances
- Reservation status
- Actual charge and released amount
- Price line items
- Immutable ledger history
- Usage receipts
- Transactional outbox events
- Signed event headers

**CTA:**

> Open the interactive demo

Link: https://resvary.vercel.app

### Use cases

**Heading:**

> Built for variable-cost AI workloads

**AI SaaS copy:**

> Sell prepaid product credits while keeping subscriptions, checkout, and invoices in your existing billing stack.

**AI API copy:**

> Authorize requests before execution and reconcile each customer charge to provider usage.

**Agent platform copy:**

> Reserve a budget for an agent run, then charge for its final steps, tools, tokens, or runtime.

**Generation product copy:**

> Rate images, audio, video, or batch jobs with units that match your provider costs.

**Paid developer tool copy:**

> Give teams auditable credit balances and retry-safe usage charges without building a ledger from scratch.

### Persistence and transaction model

**Heading:**

> Balance changes stay inside one transaction

**Body:**

> Each balance-changing command validates idempotency, checks the account and lifecycle state, writes ledger entries, updates the account snapshot, stores the domain record and outbox event, and saves the command result before commit.

**Balance definitions:**

- Posted: granted credits minus committed charges
- Reserved: credits held by open reservations
- Available: posted minus reserved

**SQLite copy:**

> The SQLite store uses `BEGIN IMMEDIATE` to serialize competing writers. It stores balances, reservations, receipts, idempotency results, and outbox events across restarts.

**Alpha boundary:**

> SQLite supports local, single-node, and design-partner deployments in the current alpha. Multi-process production deployments should use a custom `CreditStore` with equivalent transaction isolation or wait for the planned Postgres adapter.

### Arc USDC funding

**Heading:**

> Arc USDC funds the same credit ledger

**Body:**

> Arc USDC is Resvary's reference and first-class external funding path. The adapter creates an invoice, validates its payment receipt, and grants credits once for each `network + transaction hash` pair.

> Usage accounting remains payment-rail agnostic. Arc funding adds credits to the account; the reserve, commit, release, and usage receipt lifecycle stays unchanged.

**Funding flow:**

> Arc invoice → memo proof → payment receipt → funding confirmation → credit grant

**Payment and usage receipt distinction:**

- A payment receipt proves which external transfer funded an account.
- A usage receipt explains why product credits were charged.

**Testnet disclosure:**

> The current Arc integration is Testnet-first development infrastructure. The website must not describe it as a production mainnet money flow.

### Open-source section

**Heading:**

> Keep the credit ledger inside your application

**Body:**

> Resvary ships as an Apache-2.0 TypeScript monorepo. You can inspect the balance rules, run the test suite, use the embedded store interface, and extend funding without sending usage data to a hosted billing vendor.

**Repository components:**

- `@resvary/sdk/credits`: accounts, grants, reservations, usage receipts, ledger, idempotency, and outbox
- `@resvary/sdk/pricing`: meters, immutable price versions, and integer usage rating
- `@resvary/sdk/funding/arc`: Arc payment receipt to credit grant adapter
- `@resvary/sqlite`: persistent credit and payment receipt stores
- `@resvary/sdk/receipts`: stablecoin invoices, proofs, payment receipts, and signed webhooks
- `@resvary/sdk/middleware`: compatible legacy x402 middleware for Express and Next.js
- `create-resvary`: starter generator for prepaid AI credit applications

**Primary CTA:**

> Explore the GitHub repository

Link: https://github.com/horn111/resvary

**Secondary CTA:**

> Read the architecture

Link: https://github.com/horn111/resvary/blob/main/docs/architecture.md

### Comparison with a homegrown balance

**Heading:**

> A balance column records a number. Resvary records the lifecycle.

| Capability | Balance column | Resvary 0.3 alpha |
|---|---|---|
| Available balance snapshot | Yes | Yes |
| Atomic pre-request reservation | Custom work | Included |
| Actual-usage commit and release | Custom work | Included |
| Retry-safe mutating commands | Custom work | Included |
| Immutable price history | Custom work | Included |
| Per-charge usage receipts | Custom work | Included |
| Append-only ledger entries | Custom work | Included |
| Transactional outbox events | Custom work | Included |
| Funding rail independence | Depends on implementation | Included in the domain model |

### Current boundaries

**Heading:**

> Know the alpha boundary before you integrate

**Body:**

> Resvary 0.3 validates the embedded credit domain, SQLite persistence, starter integration, and Arc Testnet funding path. It does not claim to provide a hosted billing service or a complete financial stack.

**Supported product boundary:**

- Credits belong to one merchant project.
- Credits cannot move between users.
- Users cannot redeem or cash out credits.
- Resvary does not custody customer funds.
- Usage receipts are operational records, not tax invoices.

**Not included in the current alpha:**

- Hosted dashboard or managed API
- Postgres adapter
- Multi-node deployment support
- Subscription management
- Checkout UI
- Tax calculation or tax invoices
- Transferable balances
- Cash redemption
- Marketplace wallets
- Enterprise SLA or compliance certification

**Planned direction:**

- Postgres persistence
- Self-hosted HTTP service
- Hosted operations and delivery tooling
- Access control and operator workflows
- Analytics and reconciliation views

Planned items must use words such as "planned," "future," or "roadmap." Do not present them as available features.

### FAQ

**Is Resvary a payment processor?**

> No. Resvary manages closed-loop product credits and usage authorization. Keep checkout, subscriptions, tax, and fiat payment processing in the systems you already use.

**Does Resvary replace Stripe Billing, Lago, or Orb?**

> Resvary handles the real-time credit boundary around an AI operation. A broader billing platform can continue to handle checkout, subscriptions, invoicing, or finance workflows.

**Why reserve credits before the AI request?**

> The final provider cost arrives after execution. A reservation prevents concurrent requests from spending the same available balance while keeping the final charge tied to actual usage.

**What happens when the provider fails?**

> `runMetered` releases the full reservation when the provider callback throws. The account keeps its posted credits.

**What happens when billing fails after the provider succeeds?**

> The reservation remains open. Your application can retry the commit with the same idempotency key instead of losing the completed usage or charging twice.

**Can an actual charge exceed its reservation?**

> No. Your application must create another reservation before continuing work that needs a higher limit.

**Can I use my existing AI provider?**

> Yes. The core ledger does not depend on a model vendor. Your application passes estimated and actual usage into the SDK.

**Do I need crypto or Arc to use Resvary?**

> No. Manual grants can fund an account without a blockchain. Arc USDC is the reference external funding path and does not change the usage ledger.

**Is SQLite production-ready?**

> The current SQLite adapter targets local, single-node, and design-partner deployments. Multi-process production deployments need a store with equivalent transaction isolation. A Postgres adapter is planned.

**Are credits transferable or redeemable?**

> No. Resvary models non-transferable, non-redeemable product credits that customers use inside one merchant project.

**Is a usage receipt a tax invoice?**

> No. A usage receipt explains an operational credit charge. Each merchant remains responsible for its customer terms, refund policy, privacy notice, invoices, and tax treatment.

**Is Resvary free to use?**

> The current code is available under the Apache-2.0 license. No hosted paid plan exists yet.

**How can I try it?**

> Open the deterministic live demo or clone the repository and follow the getting-started guide. The demo does not require an AI API key.

### Final CTA

**Heading:**

> Put a retry-safe credit ledger around your next AI request

**Body:**

> Inspect the lifecycle in the live demo, then use the open-source repository to evaluate the SDK in your application.

**Primary CTA:**

> Explore the live demo

Link: https://resvary.vercel.app

**Secondary CTA:**

> View Resvary on GitHub

Link: https://github.com/horn111/resvary

## 5. Documentation index copy

**Page title:**

> Resvary documentation

**Introduction:**

> Learn how Resvary models prepaid credits, rates variable AI usage, protects balance changes with idempotency, persists domain state, and confirms Arc USDC funding.

**Getting started:**

> Create a ledger, register a meter and price version, grant development credits, and wrap your first provider call.

**Prepaid credits:**

> Understand accounts, reservations, commits, releases, expiry, adjustments, and idempotency.

**Usage rating:**

> Define integer usage dimensions and immutable linear price versions without JavaScript floating-point arithmetic.

**Architecture:**

> Review the transaction boundary, balance model, store interface, outbox, and separation between funding and usage receipts.

**Persistence:**

> Use the in-memory store for tests or SQLite for persistent single-node alpha deployments.

**Security and legal model:**

> Apply server-side authorization, protect secrets and customer metadata, and keep credits inside the supported closed-loop boundary.

**Arc credit funding:**

> Convert a validated Arc payment receipt into an exactly-once credit grant while keeping usage accounting rail-independent.

## 6. About copy

**Heading:**

> Resvary is building the credit ledger for AI products

**Body:**

> AI teams often start with a balance field and a usage table. Provider costs arrive after execution, and the first implementation grows into reservation rules, retry handling, price history, corrections, receipts, and reconciliation.

> Resvary packages that lifecycle as open-source TypeScript infrastructure. The project focuses on one boundary: authorizing product credits before variable-cost work and recording the final charge after it completes.

> The project began with Arc and USDC payment operations. Those modules remain part of Resvary as the first-class Arc funding path. The broader product now treats payment evidence and usage accounting as separate records connected through a funding adapter.

**Project status:**

> Resvary is an early open-source alpha. The current goal is to validate the domain model and integration surface with AI product builders before adding hosted infrastructure.

## 7. Footer copy

**Short product line:**

> Open-source prepaid credits and usage billing for AI products.

**Status line:**

> Resvary 0.3 alpha · Apache-2.0

**Footer links:**

- GitHub
- Documentation
- Live demo
- License
- Security
- Issues

**Legal boundary line:**

> Resvary provides billing software for closed-loop product credits. It does not provide custody, tax invoices, transferable balances, or cash redemption.

## 8. SEO and sharing metadata

**Homepage title:**

> Resvary | Prepaid Credits and Usage Billing for AI Products

**Homepage meta description:**

> Open-source TypeScript infrastructure for prepaid AI credits. Reserve spend before execution, charge actual usage, release the remainder, and issue auditable receipts.

**Open Graph title:**

> Resvary: Prepaid Credits for AI Products

**Open Graph description:**

> A retry-safe credit ledger for variable AI usage, with reservations, immutable prices, idempotency, and per-charge receipts.

**Documentation title:**

> Resvary Documentation | Prepaid AI Credits

**Documentation meta description:**

> Integrate prepaid credits, usage meters, reservations, immutable price versions, receipts, SQLite persistence, and Arc USDC funding.

**Suggested search phrases to use where natural:**

- prepaid credits for AI products
- AI usage billing
- AI credit ledger
- usage metering SDK
- token usage billing
- open-source billing infrastructure
- TypeScript billing SDK
- AI API credits

Do not repeat keywords unnaturally or create claims for search engines that the product cannot support.

## 9. Terminology

Use these terms consistently:

| Term | Meaning |
|---|---|
| Product credits | Closed-loop USD-denominated units used inside one merchant project |
| Posted | Granted credits minus committed charges |
| Reserved | Credits held for open work |
| Available | Posted minus reserved |
| Reservation | Maximum authorized amount held before execution |
| Commit | Final charge based on actual usage |
| Release | Removal of unused or failed-work reservation |
| Usage receipt | Operational record explaining one committed charge |
| Payment receipt | Evidence that an external transfer funded an account |
| Price version | Immutable rates used to calculate a charge |
| Idempotency key | Stable command identifier used to make retries safe |
| Funding adapter | Integration that converts verified external value into a credit grant |

Prefer these phrases:

- prepaid credits
- actual usage
- reserve, commit, and release
- auditable usage receipt
- retry-safe
- immutable ledger
- embedded TypeScript SDK
- closed-loop product credits
- Arc USDC funding

Avoid these phrases:

- crypto billing platform
- universal billing platform
- bank
- customer wallet
- stored money
- production-ready SQLite
- enterprise-ready
- fully compliant
- guaranteed savings
- instant integration
- complete billing replacement

## 10. Claims and content guardrails

The website can state these verified facts:

- Resvary is open source under Apache-2.0.
- The repository contains an embedded TypeScript SDK.
- The SDK implements grants, reservations, commits, releases, adjustments, expiry, immutable ledger entries, usage receipts, idempotency, and outbox events.
- The repository includes in-memory and SQLite credit stores.
- SQLite tests cover persistence, rollback, and concurrent reservation behavior.
- The repository includes a deterministic Next.js demo.
- The demo can use an OpenAI-compatible provider when configured.
- Arc Testnet payment receipts can fund credits through `ArcCreditFunding`.
- The credit domain does not depend on a payment rail or AI provider.

The website must not claim any of the following:

- Public customer adoption, revenue, transaction volume, or savings metrics
- Testimonials or customer logos
- Public npm availability until the packages are published
- A production hosted service, dashboard, or API
- Postgres support before the adapter ships
- Multi-node production readiness for SQLite
- Mainnet Arc payment support before it ships and receives verification
- Custody, wallet services, money transmission, tax invoicing, or regulatory compliance
- Transferable, redeemable, or cash-equivalent credits
- Enterprise SLA, certifications, audits, or guaranteed uptime

## 11. Content that should not appear yet

Do not add empty or speculative sections for:

- Pricing tiers
- Customer logos
- Testimonials
- Case studies
- Revenue or usage statistics
- Enterprise compliance badges
- Hosted signup
- API key creation
- Dashboard screenshots that imply an available hosted product
- Mainnet funding instructions

Replace absent social proof with verifiable product proof: the live demo, source code, tests, transaction model, receipts, and documented limitations.
