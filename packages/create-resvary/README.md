# create-resvary

Scaffold a Resvary application with prepaid credits and usage billing for AI products.

```bash
npm create resvary@0.6.1 my-ai-app
```

The default starter includes:

- a durable SQLite credit ledger;
- immutable meter and price versions;
- reserve, execute, commit, and release flow;
- authenticated metered AI requests using a server-owned customer ID.

Generated routes require `RESVARY_API_TOKEN` and `RESVARY_CUSTOMER_ID`. Provision credits through an authenticated signup, admin, or verified funding workflow before calling the route; the public generation endpoint never grants credits.

The CLI also keeps the original x402 paid API skeleton available as the `Legacy x402 paid API` option. Legacy paywalls fail closed until the application supplies a trusted `verifyPayment` callback.

Choose `Postgres — deployment` for a multi-process setup. The generated project includes explicit migration and worker commands; run the worker as a separate process after configuring its webhook URL and secret.

Node.js 24 or newer is required by the prepaid credits starter because it uses the built-in `node:sqlite` module.
