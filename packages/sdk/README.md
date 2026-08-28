# @resvary/sdk

Open-source prepaid credits and usage billing for AI products.

Primary imports:

```typescript
import { CreditLedger } from '@resvary/sdk/credits';
import { createMeterDefinition, createPriceVersion, rateUsage } from '@resvary/sdk/pricing';
import { ArcCreditFunding } from '@resvary/sdk/funding/arc';
```

The SDK provides USD credit accounts, manual grants, reserve/commit/release, immutable usage receipts, idempotency, a transactional outbox, and signed credit webhooks. It has no database or AI provider dependency.

Legacy stablecoin payment imports under `/receipts`, `/middleware`, `/client`, and `/gateway` remain compatible. Legacy paywall middleware requires a trusted `verifyPayment` callback and fails closed without one. `UsageMeter` and `createBillingPlan` are deprecated for new balance systems.

See the repository README and `docs/` for the complete quickstart and security model.
