# Settlary Receipts Persistence

Settlary Receipts can now run with a persistent receipt store instead of only an in-memory ledger.

The persistence layer is intentionally local-first. It is built for development, reviewer demos, restart-safe watcher flows, and production apps that want to bring their own database adapter later.

## What Persists

- invoices
- receipts
- webhook events
- webhook delivery attempts
- watcher cursors

`ReceiptLedger` and `WebhookInbox` still work as synchronous in-memory helpers. For restart-safe flows, use `PersistentReceiptLedger`, `PersistentWebhookInbox`, and a `ReceiptStore`.

## Core SDK Usage

```ts
import {
  InMemoryReceiptStore,
  PersistentReceiptLedger,
  PersistentWebhookInbox,
} from '@settlary/sdk/receipts';

const store = new InMemoryReceiptStore();
const ledger = new PersistentReceiptLedger({ store });
const inbox = new PersistentWebhookInbox({ store });
```

The store interface is async so SQLite works today and Postgres can be added later without changing the high-level ledger API.

## SQLite Usage

SQLite lives in the optional `@settlary/sqlite` workspace package so the core SDK does not require SQLite.

```ts
import { PersistentReceiptLedger } from '@settlary/sdk/receipts';
import { createSqliteReceiptStore } from '@settlary/sqlite';

const store = createSqliteReceiptStore({
  path: '.settlary/receipts.sqlite',
});

const ledger = new PersistentReceiptLedger({ store });
```

The SQLite package uses Node's built-in `node:sqlite` module and currently requires Node 24+.

## Watcher Cursors

`ReceiptWatcher` accepts an optional `cursorStore`. When provided, it persists the next block to scan per invoice/memo/network.

```ts
const watcher = new ReceiptWatcher({
  ledger,
  cursorStore: store,
  publicClient,
});
```

This lets a local watcher resume after process restart without rescanning from the original block.

## Webhook Replay

`PersistentWebhookInbox` records delivery attempts in the store. A replay after process restart will continue the attempt sequence instead of starting over from attempt `#1`.

## Current Limits

- SQLite is local/dev persistence, not a hosted managed database.
- Postgres is planned next.
- This does not add a production webhook queue.
- This does not add a hosted indexer.
- This does not broadcast transactions or handle private keys.
