# Migrating to Resvary 0.6

Resvary 0.6 changes payment verification defaults, not stored data. Upgrade all `@resvary/*` packages and `create-resvary` together to `0.6.0`. No SQLite or PostgreSQL migration runs, and the database schemas, outbox/webhook events, and CLI flags remain unchanged.

## BuyerClient payment policy

`paymentPolicy` remains optional in the TypeScript constructor so applications that never accept automatic x402 payments keep compiling. A `BuyerClient` that receives a `402` response now fails closed unless the policy is present and the payment requirements satisfy every configured limit.

```ts
import { BuyerClient } from '@resvary/sdk';

const buyer = new BuyerClient({
  privateKey: process.env.BUYER_PRIVATE_KEY,
  paymentPolicy: {
    allowedPayTo: ['0x0123456789abcdef0123456789abcdef01234567'],
    allowedOrigins: ['https://api.example.com'],
    maxAmount: '1.00',
    maxTotalAmount: '25.00',
  },
});
```

Use exact recipients and origins. The client validates the network, amount, expiry, recipient, and request origin before signing. It reserves the total budget before asynchronous approval, so concurrent requests cannot exceed the client-instance limit.

## Arc funding RPC proof

`ArcCreditFunding` confirms direct Arc funding only after it verifies the transaction through Arc Testnet RPC. Supply `rpcUrl` when the default endpoint is unsuitable. `publicClient` remains available for an injected compatible client.

```ts
import { ArcCreditFunding } from '@resvary/sdk';

const funding = new ArcCreditFunding({
  ledger,
  payTo: process.env.RESVARY_ARC_FUNDING_RECIPIENT,
  rpcUrl: process.env.RESVARY_ARC_RPC_URL,
});
```

The expected recipient, asset, network, amount, and expiry come from the persisted funding intent. Caller-supplied receipt fields are not trusted as proof. The credited amount comes from the verified onchain transfer, including valid overpayments.

## Runtime and deployment limits

- The SDK, Circle adapter, Postgres adapter, worker, and `create-resvary` support Node.js 20 or newer.
- SQLite and the demo require Node.js 24 or newer.
- SQLite is intended for local and single-node deployments. Use PostgreSQL 16–18 for multiple application or worker processes.
- Direct Arc and Circle Gateway integrations remain Testnet-only.
- Resvary is self-hosted and does not provide a hosted SLA, RBAC, compliance certification, or managed operations.
