# create-resvary

Scaffold a Resvary application with prepaid credits and usage billing for AI products.

```bash
npm create resvary@0.5.0 my-ai-app
```

The default starter includes:

- a durable SQLite credit ledger;
- immutable meter and price versions;
- reserve, execute, commit, and release flow;
- idempotent starter grants and metered AI requests.

The CLI also keeps the original x402 paid API starter available as the `Legacy x402 paid API` option.

Choose `Postgres — deployment` for a multi-process setup. The generated project includes explicit migration and worker commands; run the worker as a separate process after configuring its webhook URL and secret.

Node.js 24 or newer is required by the prepaid credits starter because it uses the built-in `node:sqlite` module.
