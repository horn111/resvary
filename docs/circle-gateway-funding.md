# Circle Gateway Nanopayment Funding

Resvary accepts Circle Gateway Nanopayments on Arc Mainnet and Testnet. The payment funds a non-expiring general credit lot. It does not replace reserve, commit, release, pricing, or usage receipts.

## Install

```bash
npm install @resvary/sdk @resvary/circle @circle-fin/x402-batching
```

```typescript
import { CreditLedger } from '@resvary/sdk/credits';
import { ARC_GATEWAY_MAINNET, GatewayNanopaymentFunding } from '@resvary/circle';

const ledger = new CreditLedger({ projectId: 'my_ai_product' });
const funding = new GatewayNanopaymentFunding({
  ledger,
  sellerAddress: '0x1111111111111111111111111111111111111111',
  network: ARC_GATEWAY_MAINNET,
});

const request = await funding.createFundingRequest({
  customerId: 'customer_123',
  amount: '5',
  expectedPayer: '0x2222222222222222222222222222222222222222',
  idempotencyKey: 'topup_123',
});
```

`request.paymentRequired` is an x402 v2 response for the official Circle batching client. The adapter rebuilds requirements from the funding intent on every settlement, including after a process restart.

## Framework-neutral HTTP handler

```typescript
import {
  ARC_GATEWAY_MAINNET,
  GatewayNanopaymentFunding,
  createNextGatewayTopUpHandler,
} from '@resvary/circle';

const funding = new GatewayNanopaymentFunding({
  ledger,
  sellerAddress: process.env.SELLER_ADDRESS as `0x${string}`,
  network: ARC_GATEWAY_MAINNET,
});

export const POST = createNextGatewayTopUpHandler({
  funding,
  resolveRequest: async (request) => {
    const session = await requireSession(request);
    return {
      customerId: session.customerId,
      amount: '5',
      expectedPayer: session.walletAddress,
      idempotencyKey: `topup:${session.customerId}:${crypto.randomUUID()}`,
    };
  },
});
```

The first request returns HTTP 402 with `Payment-Required`. The paid retry carries `Payment-Signature`. Resvary validates the accepted requirements and authorization, calls Circle verify, calls Circle settle, and only then creates the credit grant.

`createExpressGatewayTopUpHandler` wraps the same Request/Response handler for Express-compatible routes.

## Buyer

Use the official Circle buyer client:

```bash
RESVARY_GATEWAY_BUYER_PRIVATE_KEY=0x... \
  npx tsx examples/gateway-buyer.ts https://your-app.example/api/top-up
```

The buyer example targets Mainnet by default. Set `RESVARY_GATEWAY_NETWORK=testnet` for Testnet. `RESVARY_GATEWAY_DEPOSIT` moves USDC into Gateway, so use it only after confirming the selected network and amount.

## Reproducible release proof

The repository includes an env-gated Next.js proof route and a buyer runner. The route is disabled
unless `RESVARY_ENABLE_LIVE_GATEWAY=true`, and it refuses Vercel's ephemeral filesystem by default.
Run the proof locally so the 402 challenge, paid retry, settlement, grant, replay, and usage receipt
share one persistent SQLite database.

1. Copy `.env.example` to `.env.local`.
2. Set `RESVARY_GATEWAY_SELLER_ADDRESS`, `RESVARY_GATEWAY_EXPECTED_PAYER`, and
   `RESVARY_GATEWAY_BUYER_PRIVATE_KEY`. Keep the private key local.
3. Set `RESVARY_ENABLE_LIVE_GATEWAY=true`.
4. Start the demo on port 3004: `npm run dev --workspace=@resvary/demo -- --port 3004`.
5. In a second terminal, run `npm run proof:gateway`.

The historical release runner uses Circle's `GatewayClient`, optionally deposits Testnet USDC, pays the live route,
replays the same authorization, and executes one reserve/commit usage lifecycle. It writes
`docs/evidence/0.8.0/gateway-nanopayment-proof.json` without the buyer private key or full payment
signature. It also verifies the non-expiring funding lot, replay-safe grant count, and
allocation-based lifecycle. Review the JSON before committing it.

## Exactness and replay rules

- Amounts are USDC atomic units. No floating point is used.
- The authorization amount must equal the funding intent amount. Gateway overpayment is rejected.
- Scheme, selected Arc CAIP-2 network, asset, recipient, batching domain, payer, nonce, and expiry are validated.
- Mainnet funding intents require `expectedPayer` from authenticated server-side context; unsigned payment metadata cannot choose the credited customer or payer.
- Facilitator requirements must advertise the official GatewayWallet contract for the selected Arc network.
- The adapter derives an authorization hash without retaining the full signature.
- Uniqueness is `rail + network + externalPaymentId`.
- Reusing the same authorization returns the original grant.
- Reusing it for another funding intent fails.
- Credits are granted only after `settle.success`.

## Network and production boundary

Use `ARC_GATEWAY_MAINNET` for Arc Mainnet `eip155:5042` and `ARC_GATEWAY_TESTNET` for Arc Testnet `eip155:5042002`. Both use Gateway domain 26, but they use different Gateway contracts and facilitator endpoints. Never reuse a Testnet session or assume a Testnet address is funded on Mainnet.

Mainnet support moves real USDC. Keep automatic top-ups behind authenticated customer and payer context, exact recipient checks, a per-request maximum, an aggregate budget, idempotency, and operator reconciliation. Resvary creates closed-loop product credits; it does not provide custody, redemption, or compliance coverage.
