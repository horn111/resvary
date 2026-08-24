# Migrate from 0.3 to 0.4

## Package versions

Upgrade the packages together:

```bash
npm install @resvary/sdk@0.4.0-alpha.0 @resvary/sqlite@0.4.0-alpha.0
npm install @resvary/circle@0.4.0-alpha.0
```

## SQLite schema v2

Opening an existing `SqliteCreditStore` applies migration v2.

- Existing funding rows receive `rail: "arc_direct"`.
- Existing transaction hashes become `externalPaymentId`.
- New uniqueness is `rail + network + externalPaymentId`.
- Serialized funding evidence receives a normalized settled state.

Back up the SQLite file before upgrading. Run one 0.4 process for the first open, then verify `resvary_schema_migrations` contains version 2.

## Arc imports

Existing imports remain valid:

```typescript
import { ArcCreditFunding } from '@resvary/sdk/funding/arc';
```

Workers are available from:

```typescript
import { ArcFundingWorker } from '@resvary/sdk/funding';
```

## Legacy Gateway name

`@resvary/sdk/gateway` never queried Circle Gateway; it reads the native Arc RPC balance. The implementation is now named `ArcWalletBalanceClient`. `GatewayClient` remains as a deprecated alias for compatibility.

Use `@resvary/circle` for Gateway Nanopayment verification and settlement.

## Removed placeholder

`ARC_MAINNET` was a zero-address placeholder and is no longer exported. 0.4 is Testnet-only.
