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
