import { join } from 'node:path';
import {
  InMemoryReceiptStore,
  PersistentReceiptLedger,
  PersistentWebhookInbox,
  type ReceiptStore,
} from '@settlary/sdk/receipts';

export const DEMO_WEBHOOK_SECRET = 'settlary_receipts_demo_secret';
export const DEMO_WEBHOOK_TARGET = 'https://seller.app/webhooks/arc';

const globalWebhookInbox = globalThis as typeof globalThis & {
  __settlaryReceiptStore?: ReceiptStore;
  __settlaryReceiptStoreMode?: DemoReceiptStoreMode;
  __settlaryWebhookInbox?: PersistentWebhookInbox;
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
  if (globalWebhookInbox.__settlaryReceiptStore) {
    return globalWebhookInbox.__settlaryReceiptStore;
  }

  const mode = getDemoReceiptStoreMode();
  globalWebhookInbox.__settlaryReceiptStoreMode = mode;

  if (mode === 'sqlite') {
    const { createSqliteReceiptStore } = await importOptionalSqliteStore();
    const store = createSqliteReceiptStore({
      path: process.env.SETTLARY_RECEIPTS_SQLITE_PATH
        ?? join(process.cwd(), '.settlary', 'receipts.sqlite'),
    });
    globalWebhookInbox.__settlaryReceiptStore = store;
    return store;
  }

  const store = new InMemoryReceiptStore();
  globalWebhookInbox.__settlaryReceiptStore = store;
  return store;
}

export async function getDemoReceiptLedger(): Promise<PersistentReceiptLedger> {
  return new PersistentReceiptLedger({ store: await getDemoReceiptStore() });
}

export async function getDemoWebhookInbox(): Promise<PersistentWebhookInbox> {
  if (globalWebhookInbox.__settlaryWebhookInbox) {
    return globalWebhookInbox.__settlaryWebhookInbox;
  }

  globalWebhookInbox.__settlaryWebhookInbox = new PersistentWebhookInbox({
    store: await getDemoReceiptStore(),
  });
  return globalWebhookInbox.__settlaryWebhookInbox;
}

export async function getDemoReceiptStoreSummary(): Promise<DemoReceiptStoreSummary> {
  const store = await getDemoReceiptStore();
  const mode = globalWebhookInbox.__settlaryReceiptStoreMode ?? getDemoReceiptStoreMode();

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
  return process.env.SETTLARY_RECEIPTS_STORE === 'sqlite' ? 'sqlite' : 'memory';
}

async function importOptionalSqliteStore(): Promise<SqliteReceiptStoreModule> {
  try {
    const runtimeImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<SqliteReceiptStoreModule>;
    return await runtimeImport('@settlary/sqlite');
  } catch (error) {
    throw new Error(
      'SETTLARY_RECEIPTS_STORE=sqlite requires the optional @settlary/sqlite package to be installed and built.',
      { cause: error },
    );
  }
}
