import type { ProjectConfig } from '../prompts.js';

export function envTemplate(config: ProjectConfig): string {
  if (config.template === 'ai-credits') {
    return `${config.database === 'postgres' ? '# Run npm run resvary:migrate before starting the app\n# Run npm run resvary:worker as a separate process\nDATABASE_URL=postgres://postgres:postgres@localhost:5432/resvary\nRESVARY_POSTGRES_SCHEMA=public\nRESVARY_WEBHOOK_URL=https://your-app.example/webhooks/resvary\nRESVARY_WEBHOOK_SECRET=\n\n' : ''}# Server-owned API identity. Replace both values before starting the app.
RESVARY_CUSTOMER_ID=customer_123
RESVARY_API_TOKEN=

# Optional OpenAI-compatible provider
RESVARY_AI_BASE_URL=https://api.openai.com/v1
RESVARY_AI_API_KEY=
RESVARY_AI_MODEL=
`;
  }
  return `# Seller configuration
SELLER_ADDRESS=${config.payTo}
ARC_RPC_URL=https://rpc.testnet.arc.network
CHAIN_ID=5042002
`;
}
