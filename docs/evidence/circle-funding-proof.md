# Resvary 0.4 Circle Funding Evidence

This page records the reproducible public evidence for the 0.4 Circle funding release. The source JSON records are pinned to the release tag so later documentation changes cannot alter the published proof.

The proof runners generate the machine-readable source records:

- `npm run proof:arc` -> `docs/evidence/arc-testnet-proof.json`
- `npm run proof:gateway` -> `docs/evidence/gateway-nanopayment-proof.json`

Both published JSON files were reviewed for accuracy and secrets before the release metadata below was completed.

## Release

- Tag: `v0.4.0-alpha.0`
- Commit: [`667cb3df10681ac63749fdb54b5d2ec1f387f239`](https://github.com/horn111/resvary/commit/667cb3df10681ac63749fdb54b5d2ec1f387f239)
- Released at: `2026-08-24T19:12:29Z`
- Test command and count: `npm test` — 109 tests
- Live demo: [resvary.xyz](https://www.resvary.xyz)
- Direct Arc evidence: [`arc-testnet-proof.json`](https://github.com/horn111/resvary/blob/v0.4.0-alpha.0/docs/evidence/arc-testnet-proof.json)
- Gateway evidence: [`gateway-nanopayment-proof.json`](https://github.com/horn111/resvary/blob/v0.4.0-alpha.0/docs/evidence/gateway-nanopayment-proof.json)

## Proof A: direct Arc Testnet USDC

- Arcscan transaction: [`0x0e3534...0ee7`](https://testnet.arcscan.app/tx/0x0e35349f25a4bed04f760e396aaa7160c0d36e0798f098a7cabd09338d170ee7)
- Observed on-chain at: `2026-08-24T18:23:03Z`, block `58667326`, status `success`
- Payment: `0.01 USDC` from `0x1E3f8Fab778Eb5035f629Ac94a80bFf181557985` to `0x4ae8B4E11b05380d0B122D99C1A29050Cf8Eba2d`
- Memo ID: `0xdbd376db081c468f1b8672d4ffcb70f2a67a2bf94c8557185ced1fef6246408f`
- Calldata hash: `0x6e79426b370da1f555eecc6e8f7f7657929c1f9314bc7befd27f2a9acb00a56b`
- Funding intent ID: `fund_afee72861d368747806d4010`
- Payment receipt ID: `rcpt_f552b2ed72f164c2c81925e1`
- Funding transaction ID: `ftx_b3649ca6b98d2e2e6aef9c26`
- Credit grant ID: `grant_37d7a61dea227b0aca6623bc`
- Replay result: unchanged balance before and after replay; no second grant
- Restart/cursor recovery result: pending intent recovered, one receipt and one cursor persisted, no pending intent after final restart

Required evidence: recipient, actual amount, Memo ID, calldata hash, successful receipt, confirmation depth, and one unchanged balance after replay.

## Proof B: Circle Gateway Nanopayment

- Gateway deposit: [`0x5e94ca...1012`](https://testnet.arcscan.app/tx/0x5e94ca5f97104305ec884129ae61358933123d7efaadee52c9bf5c9208131012), `0.1 USDC`
- Gateway facilitator reference: `52fbe79a-542a-42bb-9c91-83b19de98e4a`
- Accepted at: `2026-08-24T18:31:15.678Z`
- Settled at: `2026-08-24T18:31:15.678Z`
- Payment: `0.01 USDC`, Arc Testnet `eip155:5042002`, Gateway domain `26`
- Payer: `0x1E3f8Fab778Eb5035f629Ac94a80bFf181557985`
- Recipient: `0x4ae8B4E11b05380d0B122D99C1A29050Cf8Eba2d`
- Funding intent ID: `fund_af095f1043618672b7fbd9c6`
- Authorization hash: `0xe5a084e6d3e0d7171bcaae9fa4eeb2a3d5548f8b5a1db52605612619220287d1`
- Nonce: `0xd80fe254250fe2d462e65b9945f1b4342a85111c4fe98fea8bac3c47d426e36a`
- Funding transaction ID: `ftx_1f53bd0d102f80b0f7d7b133`
- Credit grant ID: `grant_635edf1266ec3e2809c21f19`
- Replay result: original grant returned, balance unchanged, no second settlement call

Publish the authorization hash, nonce, payer, recipient, amount, network, and facilitator reference. Do not publish a private key or full payment signature.

## Shared credit lifecycle

For each rail, record:

```text
external payment
-> funding transaction
-> credit grant
-> account balance
-> reserve
-> AI usage
-> commit/release
-> usage receipt
```

- Arc: grant `grant_37d7a61dea227b0aca6623bc` -> reservation `rsv_38c0a8be38c00de6a865ab73` -> usage receipt `urcpt_7798555f04233fe127800af0`; charged `0.001`, released `0.001`, remaining `0.009` credits.
- Gateway: grant `grant_635edf1266ec3e2809c21f19` -> reservation `rsv_f4d6557988974d0d718d5107` -> usage receipt `urcpt_a974d1fc2536168875460162`; charged `0.001`, released `0.001`, remaining `0.009` credits.

## Grant Discussion comment

Post only after both proof sections are complete:

> Resvary v0.4.0-alpha.0 is available: https://github.com/horn111/resvary/releases/tag/v0.4.0-alpha.0.
>
> The release implements two Circle-native Testnet funding paths into one prepaid credit ledger: a verified direct Arc USDC transfer and a Circle Gateway Nanopayment. Both produce exactly one credit grant, then use the same reserve, AI usage, commit/release, and usage receipt lifecycle.
>
> Evidence: https://www.resvary.xyz, https://github.com/horn111/resvary/blob/v0.4.0-alpha.0/docs/evidence/arc-testnet-proof.json, https://github.com/horn111/resvary/blob/v0.4.0-alpha.0/docs/evidence/gateway-nanopayment-proof.json. The release passed 109 automated tests.
>
> Milestone 1: direct Arc payment request, proof validation, durable watcher recovery, and exactly-once credit grant. Milestone 2: official Circle batching SDK, facilitator verify/settle, replay-safe Gateway top-up, and linked ledger evidence.
>
> This remains an embedded, Testnet-only alpha. It does not claim custody, mainnet settlement, or production readiness.
