# Production dependency review

Reviewed on September 21, 2026 for the 1.1.1 candidate. Run `npm run audit:production` from the repository root after `npm ci`. It checks every workspace's production dependency graph, saves the raw report to `.resvary/npm-audit.json`, and rejects unapproved high or critical advisories. Registry failures and expired exceptions fail the gate too.

Rechecked on September 27, 2026 for version 1.3.0 with Circle CLI 1.1.4. The all-workspace audit still reports 7 low, 5 moderate, and 3 high affected-package entries, with the same two scoped `toml` exceptions. The separate release audit of the six public packages and Operator Console reports no vulnerabilities. npm verified registry signatures for 741 installed packages and attestations for 155. These checks do not replace the container scans.

Rechecked on September 28, 2026 after overriding Anchor's TOML parser to `4.3.0`. The all-workspace production audit reports **7 low, 7 moderate, 0 high, and 0 critical** affected-package entries, with **no temporary exceptions**. Circle CLI and Anchor still inherit moderate findings from their other dependencies; removing their inherited TOML findings moves these two entries from high to moderate. The lower-severity advisory sources remain unchanged.

The Agent Demo CI job also scans its runtime image with Trivy, blocks high/critical findings (including unfixed ones), and uploads a CycloneDX SBOM with the npm report. The runtime image prunes development dependencies and uses the maintained [Debian 13 distroless Node.js 24 runtime](https://github.com/GoogleContainerTools/distroless#what-images-are-available) without a shell or npm. CI starts the built image and checks its homepage before scanning. The scan covers operating-system packages as well as npm dependencies; a passing npm audit alone does not establish that the image passes.

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

## Patched TOML parser

The installed chain is `@circle-fin/cli@1.1.4` → `@coral-xyz/anchor@0.31.1` → `toml@4.3.0`. A root override applies only to `@coral-xyz/anchor@0.31.1`. At the September 28 review, Circle CLI's latest release was still `1.1.4`, and both its pinned Anchor `0.31.1` and the latest Anchor `0.32.1` requested TOML `^3.0.0`.

- [GHSA-82x6-q7mm-w9cf / CVE-2026-77465](https://github.com/advisories/GHSA-82x6-q7mm-w9cf): uncontrolled recursion in TOML parsing, fixed in `4.2.0`.
- [GHSA-v5mp-jgw5-2x6j / CVE-2026-63376](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j): prototype pollution in TOML parsing, fixed in `4.1.2`.

TOML `4.3.0` fixes both advisories and retains the CommonJS entry point and Buffer input support used by Anchor. [`scripts/security/toml-compat.test.mjs`](../scripts/security/toml-compat.test.mjs), included in `npm run test:release`, resolves the parser through the installed Circle CLI and Anchor packages. It checks Anchor's actual workspace loader with a temporary `Anchor.toml` and IDL, rejects deeply nested arrays and inline tables without a stack overflow, and rejects scalar-to-prototype traversal without modifying `Object.prototype`. It also starts Circle CLI's version command and help for the wallet, Gateway, and payment commands used by the application, with a temporary home directory and telemetry disabled.

The previous two exceptions, which had an October 21 deadline, have been removed from [`security/dependency-exceptions.json`](../security/dependency-exceptions.json). The policy is empty, so the npm gate and generated Trivy ignore file no longer exempt either advisory. The generic exception mechanism remains available for future reviewed cases and retains its expiry and exact-version checks.

The application still runs fixed Arc wallet and Gateway commands through [`circle-cli.ts`](../apps/agent-demo/src/lib/circle-cli.ts). The compatibility checks do not perform live payments or establish compatibility with every Solana workspace feature. Re-review the override when changing CLI dispatch, enabling Solana workspace features, or updating Anchor. Remove it once the upstream caller selects a fixed parser without an override. Replacing the CLI with maintained APIs remains an option for the remaining transitive findings, but is no longer required to meet the former TOML exception deadline.

## Maintenance

1. Let the weekly npm Dependabot check propose updates, then review the lockfile and run workspace tests, Agent Demo build, and PostgreSQL/browser CI. Group production and development minor/patch updates separately; review each major dependency update in its own PR. Keep Node type majors aligned with supported runtimes through a deliberate migration rather than an automatic upgrade to the latest Node release.
2. Remove each override once all callers resolve to a fixed compatible version without it. Keep overrides version-scoped.
3. Inspect both the raw audit report and image findings. Never add a blanket package, severity, or `ignore-unfixed` exemption to make the Agent Demo scan pass.
4. For a necessary exception, document the affected input path, exact version, owner, expiry, and removal plan in the policy and this document. The image exceptions derive from the same policy; do not maintain a second independent allowlist.

Trivy's YAML ignore format, package URL matching, and expiration rules are described in its [filtering documentation](https://trivy.dev/docs/latest/configuration/filtering/).

### Agent Demo compiler exclusion

`npm prune --omit=dev` retains TypeScript because Solana packages and Workflow's editor plugin declare it as a production peer. Next.js also retains Playwright through an optional test peer. The Docker build uses the compiler, then removes `typescript`, its `@typescript` native compiler packages, the Playwright test packages, and their executable links before copying the runtime tree. This preserves other production peers, Circle CLI, and `tsx`/esbuild for Compose migrations and the worker.

CI checks the built image for compiler packages, including nested installations, imports the persistence adapters and worker modules, and starts Circle CLI with `--version`. It then starts the web server and runs the existing Trivy gate. A future dependency that needs the TypeScript compiler at runtime requires a packaging review; do not suppress the image findings or remove another runtime peer to pass the scan.
