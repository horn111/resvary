import type { ProjectConfig } from '../prompts.js';

export function nextTemplate(config: ProjectConfig): string {
  if (config.template === 'ai-credits') {
    const persistence =
      config.database === 'postgres'
        ? `import { createPostgresCreditStore } from '@resvary/postgres';\n\nconst store = createPostgresCreditStore({\n  connectionString: process.env.DATABASE_URL!,\n  schema: process.env.RESVARY_POSTGRES_SCHEMA,\n});`
        : `import { createSqliteCreditStore } from '@resvary/sqlite';\n\nconst store = createSqliteCreditStore({ path: '.resvary/resvary.sqlite' });`;
    return `import { timingSafeEqual } from 'node:crypto';
import { CreditLedger } from '@resvary/sdk/credits';
${persistence}

const ledger = new CreditLedger({
  projectId: 'my_ai_product',
  store,
});
const customerId = process.env.RESVARY_CUSTOMER_ID;
const apiToken = process.env.RESVARY_API_TOKEN;

export async function POST(request: Request) {
  if (!customerId || !apiToken) {
    return Response.json({ error: 'Server authentication is not configured' }, { status: 503 });
  }
  if (!isAuthorized(request.headers.get('authorization'), apiToken)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { prompt, idempotencyKey } = await request.json();
  if (typeof prompt !== 'string' || typeof idempotencyKey !== 'string') {
    return Response.json({ error: 'prompt and idempotencyKey are required' }, { status: 400 });
  }
  const meter = await ledger.registerMeter({ key: 'llm_tokens', dimensions: ['input_tokens', 'output_tokens'], idempotencyKey: 'meter-v1' });
  const price = await ledger.createPriceVersion({
    meterKey: meter.key,
    rates: [
      { dimension: 'input_tokens', unitSize: '1000', amount: '0.002' },
      { dimension: 'output_tokens', unitSize: '1000', amount: '0.008' },
    ],
    idempotencyKey: 'price-v1',
  });
  const result = await ledger.runMetered({
    customerId, priceId: price.id,
    estimatedUsage: { input_tokens: '2000', output_tokens: '1000' },
    idempotencyKey: \`\${customerId}:\${idempotencyKey}\`,
  }, async () => ({
    value: { answer: \`Simulated answer for: \${prompt}\` },
    actualUsage: { input_tokens: '800', output_tokens: '240' },
    usageEventId: \`simulated:\${idempotencyKey}\`,
  }));
  return Response.json(result);
}

function isAuthorized(header: string | null, expectedToken: string): boolean {
  const providedToken = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
`;
  }
  const price =
    config.pricing === 'request' ? '0.001' : config.pricing === 'second' ? '0.01' : '0.50';

  return `import { nextPaywall } from '@resvary/sdk/middleware';

export const GET = nextPaywall(
  // This legacy middleware fails closed until a trusted verifyPayment callback is configured.
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
