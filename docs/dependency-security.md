# Production dependency review

Reviewed on September 21, 2026 for the 1.1.1 candidate. Run `npm run audit:production` from the repository root after `npm ci`. It checks every workspace's production dependency graph, saves the raw report to `.resvary/npm-audit.json`, and rejects unapproved high or critical advisories. Registry failures and expired exceptions fail the gate too.

The Agent Demo CI job also scans its runtime image with Trivy, blocks high/critical findings (including unfixed ones), and uploads a CycloneDX SBOM with the npm report. The runtime image prunes development dependencies and applies Debian security updates. Its scan covers operating-system packages as well as npm dependencies; a passing npm audit alone does not establish that the image passes.

## Changes in 1.1.1

| Dependency                  | Change               | Reason                                                                     |
| --------------------------- | -------------------- | -------------------------------------------------------------------------- |
| `workflow`                  | `4.8.8` → `4.8.9`    | Compatible upstream patch                                                  |
| `undici` 7.x                | Override to `7.29.0` | Fix the affected 7.x installations without moving callers to another major |
| `@workflow/core` → `nanoid` | Override to `5.1.16` | Replace the vulnerable generator in Workflow's dependency graph            |
| `ws@8.18.2`                 | Override to `8.21.0` | Patch the old Circle CLI / viem installation within ws 8.x                 |

At review time, root `npm audit --omit=dev` reports 15 affected-package entries: 7 low, 5 moderate, 3 high, and 0 critical. The three high entries are `toml` and the two packages that inherit its risk, `@coral-xyz/anchor` and `@circle-fin/cli`; they represent two underlying advisories. These counts are a dated snapshot, not a permanent baseline or an allowlist. Low and moderate findings remain visible in the report and require ongoing upstream updates.

The remaining lower-severity sources also ship through Circle CLI's production graph. They are not dismissed as build-only dependencies:

| Source advisory                                                                                         | Installed path from Circle CLI                                            | Disposition                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elliptic@6.6.1`, [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84), low         | `@ethersproject/abi` → ethers v5 internals → `@ethersproject/signing-key` | Keep visible; follow an upstream change to the cryptography dependency. This patch does not assert that every signing path is unreachable.        |
| `stream-json@1.9.1`, [GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x), moderate | `@solana/web3.js` → `jayson`                                              | JSON filter denial of service. No application-owned direct parser call; review the full RPC input path before enabling additional CLI transports. |
| `uuid@8.3.2`, [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), moderate        | `@solana/web3.js` → `jayson`                                              | Buffer bounds issue in specific UUID APIs. Follow the caller's supported upgrade; do not force an ESM major into the CommonJS caller.             |

These findings receive no high/critical exception. A future severity increase blocks the gate until addressed or explicitly reviewed.

## Temporary toml exceptions

The chain is `@circle-fin/cli@1.1.3` → `@coral-xyz/anchor@0.31.1` → `toml@3.0.0`.

- [GHSA-82x6-q7mm-w9cf / CVE-2026-77465](https://github.com/advisories/GHSA-82x6-q7mm-w9cf): uncontrolled recursion in TOML parsing.
- [GHSA-v5mp-jgw5-2x6j / CVE-2026-63376](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j): prototype pollution in TOML parsing.

The maintainer owns both exceptions. They expire at **2026-10-21 00:00 UTC**. Their machine-readable source is [`security/dependency-exceptions.json`](../security/dependency-exceptions.json). The npm gate matches advisory, installed path, package, and exact version. It follows inherited advisory references rather than exempting Circle CLI or Anchor wholesale. The generated Trivy ignore file uses the corresponding GHSA/CVE IDs and the exact `pkg:npm/toml@3.0.0` package URL. A new advisory or another version remains blocking.

The reviewed Anchor implementation imports `toml` in `dist/cjs/workspace.js`; parsing occurs when its Solana workspace proxy reads a local `Anchor.toml`. Circle CLI imports Anchor, but Resvary's [`circle-cli.ts`](../apps/agent-demo/src/lib/circle-cli.ts) runs fixed Arc wallet and Gateway commands through `execFile`. The application does not accept TOML, arbitrary CLI commands, or user-supplied workspace files. No path from the reviewed request inputs to the affected parser was found. This narrows exposure in these specific call sites; it does not fix the parser or establish safety for every Circle CLI command.

Re-review before enabling Solana workspace features, processing uploaded configuration, changing CLI dispatch, or changing the upstream dependency chain. Do not apply an untested major-version override to Anchor's TOML parser. Remove these exceptions when an upstream CLI/Anchor update removes the affected parser, or replace the limited CLI integration with maintained APIs and test wallet/session/Gateway behavior. If neither is completed by the deadline, CI blocks until the maintainer records a new evidence-based decision.

## Maintenance

1. Let the weekly npm Dependabot check propose updates, then review the lockfile and run workspace tests, Agent Demo build, and PostgreSQL/browser CI.
2. Remove each override once all callers resolve to a fixed compatible version without it. Keep overrides version-scoped.
3. Inspect both the raw audit report and image findings. Never add a blanket package, severity, or `ignore-unfixed` exemption to make the Agent Demo scan pass.
4. For a necessary exception, document the affected input path, exact version, owner, expiry, and removal plan in the policy and this document. The image exceptions derive from the same policy; do not maintain a second independent allowlist.

Trivy's YAML ignore format, package URL matching, and expiration rules are described in its [filtering documentation](https://trivy.dev/docs/latest/configuration/filtering/).
