# @resvary/circle

Circle-native Testnet funding adapters for the Resvary prepaid credit ledger.

- `@resvary/circle/arc`: direct Arc USDC funding and durable worker exports.
- `@resvary/circle/nanopayments`: official Circle Gateway verify/settle adapter.
- `@resvary/circle/handlers`: framework-neutral, Next.js, and Express top-up handlers.
- `@resvary/circle/gateway`: Arc Testnet Gateway constants and supported-kind validation.

```bash
npm install @resvary/sdk @resvary/circle
```

Credits are granted only after a direct Arc RPC proof or successful Gateway facilitator settlement. Funding creates non-expiring general credit lots. Resvary 0.8 funding integrations remain Testnet-only. See `docs/circle-gateway-funding.md` and `docs/funding-recovery.md`.

## Credit gate (workspace source)

`createGatewayCreditGate` tries a credit reservation and returns a Gateway funding challenge when the account lacks credits. It rounds the shortfall up to a cent. This export is part of the agent-demo work; it is not in the published 1.0.0 package yet.

Circle CLI `1.0.0` raises the accepted batching timeout to at least 30 days. For that client, construct `GatewayNanopaymentFunding` with `authorizationValiditySeconds: 30 * 24 * 60 * 60` so the advertised and accepted requirements match. This option does not extend the funding intent TTL. The adapter still checks the exact amount, recipient, network, and funding intent. Other clients retain the existing default window. The option is not in the published `1.0.0` package yet.

```ts
import { createGatewayCreditGate } from '@resvary/circle';

const gate = createGatewayCreditGate({ ledger, funding });
const outcome = await gate({
  customerId: authenticatedCustomerId,
  expectedPayer: authenticatedPayer,
  priceId,
  estimatedUsage: { input_tokens: '2000', output_tokens: '1024' },
  idempotencyKey: `reservation:${jobId}`,
  fundingIdempotencyKey: `funding:${jobId}`,
});
```

Authenticate the caller before supplying customer and payer context. Deduplicate jobs and persist a returned challenge in the application. After payment, reserve again against the current balance; funding grants credits but does not authorize execution. See `apps/agent-demo` for the durable orchestration and uncertain-payment handling.
