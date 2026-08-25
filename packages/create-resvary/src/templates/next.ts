import type { ProjectConfig } from '../prompts.js';

export function nextTemplate(config: ProjectConfig): string {
  if (config.template === 'ai-credits') {
    const persistence =
      config.database === 'postgres'
        ? `import { createPostgresCreditStore } from '@resvary/postgres';\n\nconst store = createPostgresCreditStore({\n  connectionString: process.env.DATABASE_URL!,\n  schema: process.env.RESVARY_POSTGRES_SCHEMA,\n});`
        : `import { createSqliteCreditStore } from '@resvary/sqlite';\n\nconst store = createSqliteCreditStore({ path: '.resvary/resvary.sqlite' });`;
    return `import { CreditLedger } from '@resvary/sdk/credits';
${persistence}

const ledger = new CreditLedger({
  projectId: 'my_ai_product',
  store,
});

export async function POST(request: Request) {
  const { customerId, prompt, idempotencyKey } = await request.json();
  const meter = await ledger.registerMeter({ key: 'llm_tokens', dimensions: ['input_tokens', 'output_tokens'], idempotencyKey: 'meter-v1' });
  const price = await ledger.createPriceVersion({
    meterKey: meter.key,
    rates: [
      { dimension: 'input_tokens', unitSize: '1000', amount: '0.002' },
      { dimension: 'output_tokens', unitSize: '1000', amount: '0.008' },
    ],
    idempotencyKey: 'price-v1',
  });
  await ledger.grantCredits({
    customerId,
    amount: '5',
    idempotencyKey: \`starter-credit:\${customerId}\`,
  });
  const result = await ledger.runMetered({
    customerId, priceId: price.id,
    estimatedUsage: { input_tokens: '2000', output_tokens: '1000' }, idempotencyKey,
  }, async () => ({
    value: { answer: \`Simulated answer for: \${prompt}\` },
    actualUsage: { input_tokens: '800', output_tokens: '240' },
    usageEventId: \`simulated:\${idempotencyKey}\`,
  }));
  return Response.json(result);
}
`;
  }
  const price =
    config.pricing === 'request' ? '0.001' : config.pricing === 'second' ? '0.01' : '0.50';

  return `import { nextPaywall } from '@resvary/sdk/middleware';

export const GET = nextPaywall(
  { 
    price: '${price}', 
    network: 'arc-testnet',
    description: 'Premium Data API (${config.pricing} pricing)'
  },
  async (request) => {
    return Response.json({ 
      success: true, 
      data: 'Here is your premium content!',
      timestamp: new Date().toISOString()
    });
  }
);
`;
}
