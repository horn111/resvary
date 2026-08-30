# Resvary 0.6.0 Testnet evidence

These records were generated locally on 2026-08-30 from the `release/v0.6.0` worktree after updating `viem` to 2.56.0, x402 packages to 2.24.0, and Circle x402 batching to 3.4.0. Both rails use funded Testnet accounts. They do not represent mainnet settlement, custody, or a production SLA.

## Direct Arc

[`arc-testnet-proof.json`](arc-testnet-proof.json) records a 0.01 USDC Arc Testnet funding transaction. The proof confirms:

- the pending funding intent survives a worker restart;
- the worker obtains transaction evidence from Arc RPC and persists its cursor;
- replaying the same receipt leaves the balance unchanged;
- reserve, commit, and release charge 0.001 and release the unused 0.001 estimate.

The public transaction is [0x988d…aca7f](https://testnet.arcscan.app/tx/0x988d91a71398f62ab7086222c53c0be4eb23b3d41da371571e036d3ab96aca7f).

## Circle Gateway Nanopayment

[`gateway-nanopayment-proof.json`](gateway-nanopayment-proof.json) records a 0.01 USDC Gateway Testnet settlement. The proof confirms:

- the facilitator settled the payment;
- replay returns the same grant without changing the balance;
- the Gateway available balance decreased by the payment amount;
- the same reserve, commit, and release lifecycle completed.

## Privacy

The evidence includes public Testnet addresses, transaction identifiers, hashes, nonces, and internal proof IDs. It does not include private keys, admin tokens, complete payment signatures, environment files, or customer payloads. The JSON privacy fields are checked before release.
