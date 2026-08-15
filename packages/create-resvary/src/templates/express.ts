import type { ProjectConfig } from '../prompts.js';

export function expressTemplate(config: ProjectConfig): string {
  if (config.template === 'ai-credits') {
    return `import express from 'express';
import { CreditLedger } from '@resvary/sdk/credits';
import { createSqliteCreditStore } from '@resvary/sqlite';

const app = express();
app.use(express.json());

const ledger = new CreditLedger({
  projectId: 'my_ai_product',
  store: createSqliteCreditStore({ path: '.resvary/resvary.sqlite' }),
});

app.post('/api/generate', async (req, res, next) => {
  try {
    const { customerId, prompt, idempotencyKey } = req.body;
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
    await ledger.grantCredits({
      customerId,
      amount: '5',
      idempotencyKey: \`starter-credit:\${customerId}\`,
    });
    const result = await ledger.runMetered(
      {
        customerId,
        priceId: price.id,
        estimatedUsage: { input_tokens: '2000', output_tokens: '1000' },
        idempotencyKey,
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

app.listen(process.env.PORT || 3000, () => {
  console.log('Resvary AI credits API is running on http://localhost:3000');
});
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
