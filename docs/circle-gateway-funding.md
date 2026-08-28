# Circle Gateway Nanopayment Funding

Resvary 0.4 accepts Circle Gateway Nanopayments as a Testnet top-up rail. The payment funds closed-loop product credits. It does not replace reserve, commit, release, pricing, or usage receipts.

## Install

```bash
npm install @resvary/sdk @resvary/circle @circle-fin/x402-batching
```

```typescript
import { CreditLedger } from '@resvary/sdk/credits';
import { GatewayNanopaymentFunding } from '@resvary/circle/nanopayments';

const ledger = new CreditLedger({ projectId: 'my_ai_product' });
const funding = new GatewayNanopaymentFunding({
  ledger,
  sellerAddress: '0x1111111111111111111111111111111111111111',
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
import { GatewayNanopaymentFunding, createNextGatewayTopUpHandler } from '@resvary/circle';

const funding = new GatewayNanopaymentFunding({
  ledger,
  sellerAddress: process.env.SELLER_ADDRESS as `0x${string}`,
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

Set `RESVARY_GATEWAY_DEPOSIT=10` only when the buyer needs a Testnet Gateway deposit.

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

The runner uses Circle's `GatewayClient`, optionally deposits Testnet USDC, pays the live route,
replays the same authorization, and executes one reserve/commit usage lifecycle. It writes
`docs/evidence/gateway-nanopayment-proof.json` without the buyer private key or full payment
signature. Review the JSON before committing it.

## Exactness and replay rules

- Amounts are USDC atomic units. No floating point is used.
- The authorization amount must equal the funding intent amount. Gateway overpayment is rejected.
- Scheme, Arc Testnet CAIP-2 network, asset, recipient, batching domain, payer, nonce, and expiry are validated.
- The adapter derives an authorization hash without retaining the full signature.
- Uniqueness is `rail + network + externalPaymentId`.
- Reusing the same authorization returns the original grant.
- Reusing it for another funding intent fails.
- Credits are granted only after `settle.success`.

## Testnet boundary

0.4 supports Arc Testnet `eip155:5042002`, Gateway domain 26. The package does not expose an Arc mainnet preset. Do not describe this release as production settlement, custody, or a mainnet money flow.
