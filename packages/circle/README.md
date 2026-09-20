# @resvary/circle

Circle-native Arc Mainnet and Testnet funding adapters for the Resvary prepaid credit ledger.

- `@resvary/circle/arc`: direct Arc USDC funding and durable worker exports.
- `@resvary/circle/nanopayments`: official Circle Gateway verify/settle adapter.
- `@resvary/circle/handlers`: framework-neutral, Next.js, and Express top-up handlers.
- `@resvary/circle/gateway`: Arc Mainnet/Testnet Gateway constants and supported-kind validation.

```bash
npm install @resvary/sdk @resvary/circle
```

Credits are granted only after a direct Arc RPC proof or successful Gateway facilitator settlement. Funding creates non-expiring general credit lots. Mainnet must be selected explicitly; the adapter keeps Testnet as its backward-compatible default. See `docs/circle-gateway-funding.md` and `docs/funding-recovery.md`.

## Credit gate (workspace source)

`createGatewayCreditGate` tries a credit reservation and returns a Gateway funding challenge when the account lacks credits. It rounds the shortfall up to a cent. The export is available from `@resvary/circle` 1.1.0.

Circle CLI raises the accepted batching timeout to at least 30 days. For that client, construct `GatewayNanopaymentFunding` with `authorizationValiditySeconds: 30 * 24 * 60 * 60` so the advertised and accepted requirements match. This option does not extend the funding intent TTL. The adapter still checks the exact amount, recipient, network, and funding intent.

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

Authenticate the caller before supplying customer and payer context. Mainnet funding requires `expectedPayer`, and the adapter pins facilitator requirements to the selected network's official GatewayWallet contract. Deduplicate jobs and persist a returned challenge in the application. After payment, reserve again against the current balance; funding grants credits but does not authorize execution. See `apps/agent-demo` for the durable orchestration and uncertain-payment handling.
