# create-resvary

Scaffold a Resvary application with prepaid credits and usage billing for AI products.

```bash
npm create resvary@latest my-ai-app
```

The default starter includes:

- a durable SQLite credit ledger;
- immutable meter and price versions;
- reserve, execute, commit, and release flow;
- idempotent starter grants and metered AI requests.

The CLI also keeps the original x402 paid API starter available as the `Legacy x402 paid API` option.

Node.js 24 or newer is required by the prepaid credits starter because it uses the built-in `node:sqlite` module.
