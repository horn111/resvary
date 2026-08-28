import type { ProjectConfig } from '../prompts.js';

export function expressTemplate(config: ProjectConfig): string {
  if (config.template === 'ai-credits') {
    const persistence =
      config.database === 'postgres'
        ? `import { createPostgresCreditStore } from '@resvary/postgres';\n\nconst store = createPostgresCreditStore({\n  connectionString: process.env.DATABASE_URL!,\n  schema: process.env.RESVARY_POSTGRES_SCHEMA,\n});`
        : `import { createSqliteCreditStore } from '@resvary/sqlite';\n\nconst store = createSqliteCreditStore({ path: '.resvary/resvary.sqlite' });`;
    return `import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { CreditLedger } from '@resvary/sdk/credits';
${persistence}

const app = express();
app.use(express.json());

const ledger = new CreditLedger({
  projectId: 'my_ai_product',
  store,
});
const customerId = process.env.RESVARY_CUSTOMER_ID;
const apiToken = process.env.RESVARY_API_TOKEN;
if (!customerId || !apiToken) {
  throw new Error('Set RESVARY_CUSTOMER_ID and RESVARY_API_TOKEN before starting the API');
}

app.post('/api/generate', async (req, res, next) => {
  try {
    if (!isAuthorized(req.headers.authorization, apiToken)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { prompt, idempotencyKey } = req.body;
    if (typeof prompt !== 'string' || typeof idempotencyKey !== 'string') {
      res.status(400).json({ error: 'prompt and idempotencyKey are required' });
      return;
    }
    const meter = await ledger.registerMeter({
      key: 'llm_tokens',
      dimensions: ['input_tokens', 'output_tokens'],
      idempotencyKey: 'meter-v1',
    });
    const price = await ledger.createPriceVersion({
      meterKey: meter.key,
      rates: [
        { dimension: 'input_tokens', unitSize: '1000', amount: '0.002' },
        { dimension: 'output_tokens', unitSize: '1000', amount: '0.008' },
      ],
      idempotencyKey: 'price-v1',
    });
    const result = await ledger.runMetered(
      {
        customerId,
        priceId: price.id,
        estimatedUsage: { input_tokens: '2000', output_tokens: '1000' },
        idempotencyKey: \`\${customerId}:\${idempotencyKey}\`,
      },
      async () => ({
        value: { answer: \`Simulated answer for: \${prompt}\` },
        actualUsage: { input_tokens: '800', output_tokens: '240' },
        usageEventId: \`simulated:\${idempotencyKey}\`,
      }),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

function isAuthorized(header: string | undefined, expectedToken: string): boolean {
  const providedToken = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const server = app.listen(process.env.PORT || 3000, () => {
  console.log('Resvary AI credits API is running on http://localhost:3000');
});

async function shutdown() {
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
`;
  }

  const price =
    config.pricing === 'request' ? '0.001' : config.pricing === 'second' ? '0.01' : '0.50';

  return `import express from 'express';
import { expressPaywall } from '@resvary/sdk/middleware';

const app = express();
const port = process.env.PORT || 3000;

app.get(
  '/api/data',
  // This legacy middleware fails closed until a trusted verifyPayment callback is configured.
  expressPaywall({
    price: '${price}',
    network: 'arc-testnet',
    description: 'Premium Data API (${config.pricing} pricing)',
  }),
  (_req, res) => {
    res.json({
      success: true,
      data: 'Here is your premium content!',
      timestamp: new Date().toISOString(),
    });
  },
);

app.listen(port, () => {
  console.log(\`Paid API running on http://localhost:\${port}\`);
});
`;
}
