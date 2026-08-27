# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.5.x   | :white_check_mark: |
| < 0.5   | :x:                |

## Prepaid credits alpha

The `0.5.0-alpha.2` credit engine is intended for evaluation and design-partner deployments. SQLite is a local or single-node backend. Postgres supports multi-process deployments but does not carry a production SLA or compliance certification.

- Authorize `customerId`, grants, adjustments, price IDs, and project scope on the server.
- Never expose admin grant or adjustment operations directly to an untrusted client.
- Keep API keys, sensitive prompts, and personal information out of metadata.
- Use stable idempotency keys for all retries.
- Treat closed-loop credits separately from transferable funds, custody, tax invoices, and redemption.
- Run Postgres migrations with a separate least-privilege deployment role.
- Keep database URLs and webhook secrets in a secret manager and rotate them after suspected exposure.
- Verify `x-resvary-signature` and deduplicate `x-resvary-event-id` before processing webhook side effects.

See [docs/credit-security-model.md](docs/credit-security-model.md) for the full model.

## Reporting a Vulnerability

We take the security of Resvary seriously. If you believe you have found a security vulnerability, please report it to us as described below.

**Please do NOT report security vulnerabilities through public GitHub issues.**

### How to Report

Use [GitHub private vulnerability reporting](https://github.com/horn111/resvary/security/advisories/new) to send the maintainers the following information. Do not include secrets, private keys, or customer payloads in the report.

- Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity, typically within 2 weeks for critical issues

### Scope

The following are in scope for security reports:

- **USDC payment handling** — Any vulnerability in payment signing, verification, or settlement
- **Key management** — Issues related to wallet key storage, exposure, or misuse
- **Middleware bypass** — Circumventing payment verification in Express/Next.js middleware
- **Gateway interactions** — Vulnerabilities in Circle Gateway API integration
- **Data exposure** — Unintended exposure of billing data, usage metrics, or user information

### Out of Scope

- Issues in upstream dependencies (report these to the respective maintainers)
- Issues in Circle's infrastructure (report to [Circle Security](https://www.circle.com/security))
- Issues in the x402 protocol itself (report to [x402 Foundation](https://github.com/x402-foundation/x402))

## Security Best Practices

When using Resvary in production:

1. **Never commit `.env` files** — Use environment variables or secrets managers
2. **Rotate wallet keys regularly** — Especially for seller-side payment collection
3. **Use HTTPS only** — x402 payment headers contain sensitive authorization data
4. **Validate payment amounts** — Always verify amounts server-side, never trust client input
5. **Monitor Gateway balances** — Set up alerts for unexpected balance changes
6. **Keep dependencies updated** — Run `npm audit` regularly
