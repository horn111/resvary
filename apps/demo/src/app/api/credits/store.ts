import { CreditLedger, type PriceVersion } from '@resvary/sdk/credits';
import { createSqliteCreditStore, type SqliteCreditStore } from '@resvary/sqlite';

type DemoGlobal = typeof globalThis & {
  __resvaryCreditStore?: SqliteCreditStore;
  __resvaryCreditLedger?: CreditLedger;
  __resvaryCreditPrice?: PriceVersion;
};

const demoGlobal = globalThis as DemoGlobal;

export async function getDemoCredits(): Promise<{ ledger: CreditLedger; price: PriceVersion }> {
  if (!demoGlobal.__resvaryCreditStore) {
    demoGlobal.__resvaryCreditStore = createSqliteCreditStore({
      path: process.env.RESVARY_CREDITS_DB_PATH ?? '.resvary/demo.sqlite',
    });
  }
  if (!demoGlobal.__resvaryCreditLedger) {
    demoGlobal.__resvaryCreditLedger = new CreditLedger({
      projectId: 'resvary_ai_demo',
      store: demoGlobal.__resvaryCreditStore,
    });
  }
  if (!demoGlobal.__resvaryCreditPrice) {
    const meter = await demoGlobal.__resvaryCreditLedger.registerMeter({
      key: 'llm_tokens',
      name: 'LLM tokens',
      dimensions: ['input_tokens', 'output_tokens'],
      idempotencyKey: 'demo-meter-v1',
    });
    demoGlobal.__resvaryCreditPrice = await demoGlobal.__resvaryCreditLedger.createPriceVersion({
      meterKey: meter.key,
      rates: [
        { dimension: 'input_tokens', unitSize: '1000', amount: '0.002' },
        { dimension: 'output_tokens', unitSize: '1000', amount: '0.008' },
      ],
      idempotencyKey: 'demo-price-v1',
    });
  }
  return { ledger: demoGlobal.__resvaryCreditLedger, price: demoGlobal.__resvaryCreditPrice };
}
