import { createPostgresCreditStore } from '@resvary/postgres';
import { CreditLedger, type CreditStore, type PriceVersion } from '@resvary/sdk/credits';
import { createSqliteCreditStore } from '@resvary/sqlite';

type DemoGlobal = typeof globalThis & {
  __resvaryCreditStore?: CreditStore;
  __resvaryCreditLedger?: CreditLedger;
  __resvaryCreditPrice?: PriceVersion;
};

const demoGlobal = globalThis as DemoGlobal;

export async function getDemoCredits(): Promise<{ ledger: CreditLedger; price: PriceVersion }> {
  if (!demoGlobal.__resvaryCreditStore) {
    demoGlobal.__resvaryCreditStore = createDemoCreditStore();
  }
  if (!demoGlobal.__resvaryCreditLedger) {
    demoGlobal.__resvaryCreditLedger = new CreditLedger({
      projectId: 'resvary_ai_demo',
      store: demoGlobal.__resvaryCreditStore,
    });
  }
  if (!demoGlobal.__resvaryCreditPrice) {
    const meter = await demoGlobal.__resvaryCreditLedger.registerMeter({
      key: 'llm_multimodal',
      name: 'LLM tokens and images',
      dimensions: ['input_tokens', 'output_tokens', 'images'],
      idempotencyKey: 'demo-meter-v2',
    });
    demoGlobal.__resvaryCreditPrice = await demoGlobal.__resvaryCreditLedger.createPriceVersion({
      meterKey: meter.key,
      rates: [{ dimension: 'output_tokens', unitSize: '1000', amount: '0.008' }],
      components: [
        {
          model: 'graduated',
          dimension: 'input_tokens',
          tiers: [
            { upTo: '1000', unitSize: '1000', amount: '0.002' },
            { unitSize: '1000', amount: '0.0015' },
          ],
        },
        { model: 'package', dimension: 'images', packageSize: '10', amount: '0.5' },
      ],
      idempotencyKey: 'demo-price-v2',
    });
  }
  return { ledger: demoGlobal.__resvaryCreditLedger, price: demoGlobal.__resvaryCreditPrice };
}

export function getDemoPersistenceLabel(): string {
  return process.env.DATABASE_URL?.trim()
    ? 'PostgreSQL'
    : process.env.RESVARY_CREDITS_DB_PATH?.trim() || '.resvary/demo.sqlite';
}

function createDemoCreditStore(): CreditStore {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return createSqliteCreditStore({
      path: process.env.RESVARY_CREDITS_DB_PATH?.trim() || '.resvary/demo.sqlite',
    });
  }

  const databaseUrl = new URL(connectionString);
  if (['prefer', 'require', 'verify-ca'].includes(databaseUrl.searchParams.get('sslmode') ?? '')) {
    databaseUrl.searchParams.set('sslmode', 'verify-full');
  }
  return createPostgresCreditStore({
    connectionString: databaseUrl.href,
    poolConfig: {
      max: 3,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    },
  });
}
