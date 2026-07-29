import type { ProjectConfig } from '../prompts.js';

export function nextTemplate(config: ProjectConfig): string {
  const price = config.pricing === 'request' ? '0.001' : config.pricing === 'second' ? '0.01' : '0.50';

  return `import { nextPaywall } from '@settlary/sdk/middleware';

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
