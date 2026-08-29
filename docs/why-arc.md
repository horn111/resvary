# Why Arc?

> Arc is Resvary's reference settlement network for external USDC funding. Resvary keeps credit accounting separate from settlement, so manual grants and future payment sources can use the same ledger.

Resvary built and proved its external funding lifecycle on [Arc](https://arc.network), Circle's Layer 1 blockchain. Direct Arc transfers and Circle Gateway Nanopayments on Arc feed the same reserve, commit, release, and usage-receipt lifecycle.

## USDC-Native Gas

Arc is the first major blockchain where **USDC is the native gas token**. This means:

- **No ETH management** — Your billing system doesn't need to hold volatile assets for gas
- **Dollar-denominated costs** — Gas fees are predictable and priced in USD
- **Single-token operations** — Payments and gas use the same token, simplifying accounting
- **No price oracle dependency** — No need to convert between ETH and USD for billing

## Sub-Second Finality

Arc's Malachite BFT consensus provides **deterministic, sub-second finality**:

- **Instant settlement** — Payments are final in under 1 second
- **No reorg risk** — Deterministic finality means no transaction reversals
- **Real-time billing** — Perfect for per-second and streaming payment models
- **Better UX** — Users see immediate payment confirmation

## Nanopayments via Gateway

Circle Gateway enables **gasless, sub-cent USDC payments** through batched settlement:

- **$0.000001 minimum** — Payments as small as one-millionth of a dollar
- **Zero gas for buyers** — Off-chain EIP-3009 signatures, no on-chain tx per payment
- **Batch efficiency** — Thousands of payments settled in a single on-chain transaction
- **Cross-chain unified balance** — Fund once, pay across all supported chains

## Built for Agents

Arc is designed with autonomous AI agents as first-class citizens:

- **Agent Wallets** — Permissionless, policy-controlled wallets for autonomous operation
- **x402 Protocol** — HTTP-native payment standard that agents can use without human intervention
- **Programmable Money** — USDC on Arc supports `transferWithAuthorization` for gasless, programmatic transfers
- **Service Discovery** — Agents can discover and pay for APIs autonomously via 402 responses

## Comparison

| Feature      | Arc       | Ethereum | Base     | Solana   |
| ------------ | --------- | -------- | -------- | -------- |
| Gas Token    | USDC      | ETH      | ETH      | SOL      |
| Finality     | <1s       | ~12min   | ~2s      | ~0.4s    |
| Min Payment  | $0.000001 | ~$0.50   | ~$0.001  | ~$0.001  |
| Gas per Tx   | ~$0.001   | ~$1-50   | ~$0.01   | ~$0.0001 |
| Nanopayments | Native    | Via L2   | Via x402 | Via x402 |
| USDC Native  | ✅        | ❌       | ❌       | ❌       |

## Network Details

| Parameter   | Value                                              |
| ----------- | -------------------------------------------------- |
| Network     | Arc Testnet                                        |
| Chain ID    | `5042002`                                          |
| RPC URL     | `https://rpc.testnet.arc.network`                  |
| Explorer    | [testnet.arcscan.app](https://testnet.arcscan.app) |
| Faucet      | [faucet.circle.com](https://faucet.circle.com)     |
| Currency    | USDC (6 decimals)                                  |
| Consensus   | Malachite BFT                                      |
| Mainnet ETA | Summer 2026                                        |
