import { CreditLedger, type PriceVersion } from '@settlary/sdk/credits';
import { createSqliteCreditStore, type SqliteCreditStore } from '@settlary/sqlite';

type DemoGlobal = typeof globalThis & {
  __settlaryCreditStore?: SqliteCreditStore;
  __settlaryCreditLedger?: CreditLedger;
  __settlaryCreditPrice?: PriceVersion;
};

const demoGlobal = globalThis as DemoGlobal;

export async function getDemoCredits(): Promise<{ ledger: CreditLedger; price: PriceVersion }> {
  if (!demoGlobal.__settlaryCreditStore) {
    demoGlobal.__settlaryCreditStore = createSqliteCreditStore({
      path: process.env.SETTLARY_CREDITS_DB_PATH ?? '.settlary/demo.sqlite',
    });
  }
  if (!demoGlobal.__settlaryCreditLedger) {
    demoGlobal.__settlaryCreditLedger = new CreditLedger({
      projectId: 'settlary_ai_demo',
      store: demoGlobal.__settlaryCreditStore,
    });
  }
  if (!demoGlobal.__settlaryCreditPrice) {
    const meter = await demoGlobal.__settlaryCreditLedger.registerMeter({
      key: 'llm_tokens',
      name: 'LLM tokens',
      dimensions: ['input_tokens', 'output_tokens'],
      idempotencyKey: 'demo-meter-v1',
    });
    demoGlobal.__settlaryCreditPrice = await demoGlobal.__settlaryCreditLedger.createPriceVersion({
      meterKey: meter.key,
      rates: [
        { dimension: 'input_tokens', unitSize: '1000', amount: '0.002' },
        { dimension: 'output_tokens', unitSize: '1000', amount: '0.008' },
      ],
      idempotencyKey: 'demo-price-v1',
    });
  }
  return { ledger: demoGlobal.__settlaryCreditLedger, price: demoGlobal.__settlaryCreditPrice };
}
