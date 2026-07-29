import type { ProjectConfig } from '../prompts.js';

export function expressTemplate(config: ProjectConfig): string {
  const price = config.pricing === 'request' ? '0.001' : config.pricing === 'second' ? '0.01' : '0.50';

  return `import express from 'express';
import { expressPaywall } from '@settlary/sdk/middleware';

const app = express();
const port = process.env.PORT || 3000;

app.get('/api/data',
  expressPaywall({ 
    price: '${price}', 
    network: 'arc-testnet',
    description: 'Premium Data API (${config.pricing} pricing)'
  }),
  (req, res) => {
    res.json({ 
      success: true, 
      data: 'Here is your premium content!',
      timestamp: new Date().toISOString()
    });
  }
);

app.listen(port, () => {
  console.log(\`🚀 Paid API running on http://localhost:\${port}\`);
});
`;
}
