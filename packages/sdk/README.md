# @resvary/sdk

Open-source prepaid credits and usage billing for AI products.

Primary imports:

```typescript
import { CreditLedger } from '@resvary/sdk/credits';
import { createMeterDefinition, createPriceVersion, rateUsage } from '@resvary/sdk/pricing';
import { ArcCreditFunding } from '@resvary/sdk/funding/arc';
```

The SDK provides USD credit accounts, linear, graduated, and package pricing, manual grants, recurring allowance policies, expiring promotions, deterministic credit lots, reserve/commit/release, immutable usage receipts, idempotency, a transactional outbox, and signed credit webhooks. It has no database or AI provider dependency. Policy commands require the optional `CreditPolicyStore` capability; existing custom `CreditStore` implementations retain their previous flows.

Advanced price versions use `components`: graduated tiers charge each cumulative range independently, while package pricing charges every started block. Existing `rates` and linear receipt line items remain unchanged. See `docs/usage-rating.md` in the repository.

Legacy stablecoin payment imports remain under `/receipts`, `/middleware`, `/client`, and `/gateway`. Legacy paywall middleware requires a trusted `verifyPayment` callback and fails closed without one. `BuyerClient` also fails closed on `402` unless the caller configures per-request and total spend limits plus a recipient allowlist. `UsageMeter` and `createBillingPlan` are deprecated for new balance systems.

See the repository README and `docs/` for the complete quickstart and security model.
