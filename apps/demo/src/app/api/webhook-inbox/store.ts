import { join } from 'node:path';
import {
  InMemoryReceiptStore,
  PersistentReceiptLedger,
  PersistentWebhookInbox,
  type ReceiptStore,
} from '@resvary/sdk/receipts';

export const DEMO_WEBHOOK_SECRET = 'resvary_receipts_demo_secret';
export const DEMO_WEBHOOK_TARGET = 'https://seller.app/webhooks/arc';

const globalWebhookInbox = globalThis as typeof globalThis & {
  __resvaryReceiptStore?: ReceiptStore;
  __resvaryReceiptStoreMode?: DemoReceiptStoreMode;
  __resvaryWebhookInbox?: PersistentWebhookInbox;
};

export type DemoReceiptStoreMode = 'memory' | 'sqlite';

export type DemoReceiptStoreSummary = {
  mode: DemoReceiptStoreMode;
  persistent: boolean;
  invoiceCount: number;
  receiptCount: number;
  webhookDeliveryCount: number;
  watcherCursorCount: number;
};

type SqliteReceiptStoreModule = {
  createSqliteReceiptStore(config: { path: string }): ReceiptStore;
};

export async function getDemoReceiptStore(): Promise<ReceiptStore> {
  if (globalWebhookInbox.__resvaryReceiptStore) {
    return globalWebhookInbox.__resvaryReceiptStore;
  }

  const mode = getDemoReceiptStoreMode();
  globalWebhookInbox.__resvaryReceiptStoreMode = mode;

  if (mode === 'sqlite') {
    const { createSqliteReceiptStore } = await importOptionalSqliteStore();
    const store = createSqliteReceiptStore({
      path:
        process.env.RESVARY_RECEIPTS_SQLITE_PATH ??
        join(process.cwd(), '.resvary', 'receipts.sqlite'),
    });
    globalWebhookInbox.__resvaryReceiptStore = store;
    return store;
  }

  const store = new InMemoryReceiptStore();
  globalWebhookInbox.__resvaryReceiptStore = store;
  return store;
}

export async function getDemoReceiptLedger(): Promise<PersistentReceiptLedger> {
  return new PersistentReceiptLedger({ store: await getDemoReceiptStore() });
}

export async function getDemoWebhookInbox(): Promise<PersistentWebhookInbox> {
  if (globalWebhookInbox.__resvaryWebhookInbox) {
    return globalWebhookInbox.__resvaryWebhookInbox;
  }

  globalWebhookInbox.__resvaryWebhookInbox = new PersistentWebhookInbox({
    store: await getDemoReceiptStore(),
  });
  return globalWebhookInbox.__resvaryWebhookInbox;
}

export async function getDemoReceiptStoreSummary(): Promise<DemoReceiptStoreSummary> {
  const store = await getDemoReceiptStore();
  const mode = globalWebhookInbox.__resvaryReceiptStoreMode ?? getDemoReceiptStoreMode();

  return {
    mode,
    persistent: mode === 'sqlite',
    invoiceCount: (await store.listInvoices()).length,
    receiptCount: (await store.listReceipts()).length,
    webhookDeliveryCount: (await store.listWebhookDeliveries()).length,
    watcherCursorCount: (await store.listWatcherCursors()).length,
  };
}

function getDemoReceiptStoreMode(): DemoReceiptStoreMode {
  return process.env.RESVARY_RECEIPTS_STORE === 'sqlite' ? 'sqlite' : 'memory';
}

async function importOptionalSqliteStore(): Promise<SqliteReceiptStoreModule> {
  try {
    const runtimeImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<SqliteReceiptStoreModule>;
    return await runtimeImport('@resvary/sqlite');
  } catch (error) {
    throw new Error(
      'RESVARY_RECEIPTS_STORE=sqlite requires the optional @resvary/sqlite package to be installed and built.',
      { cause: error },
    );
  }
}
