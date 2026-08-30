# Getting Started

## Install

```bash
npm install @resvary/sdk @resvary/sqlite
```

Use Node.js 24+ for SQLite. The core SDK supports Node.js 20+.

## Configure credits

Follow the quickstart in the root README to create a ledger, meter, and immutable price version. Grant development credits with a stable idempotency key, then wrap the first provider call with `runMetered`.

## Scaffold an application

```bash
npx create-resvary@0.6.0 my-ai-product
```

Choose `AI prepaid credits` and either Next.js or Express. The legacy x402 paid API starter remains an explicit alternate template.

## Run this repository

```bash
npm install
npm run dev
```

Set `RESVARY_DEMO_ADMIN_TOKEN` and a separate `RESVARY_WEBHOOK_SECRET`, open [http://localhost:3000](http://localhost:3000), enter the admin token, grant `$5`, and run the simulated AI operation. Repeat the same request to inspect idempotency, or trigger provider failure to verify full release.

Read [prepaid-credits.md](prepaid-credits.md), [usage-rating.md](usage-rating.md), and [credit-security-model.md](credit-security-model.md) before integrating production data.
