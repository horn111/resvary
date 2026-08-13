import type { ProjectConfig } from '../prompts.js';

export function envTemplate(config: ProjectConfig): string {
  if (config.template === 'ai-credits') {
    return `# Optional OpenAI-compatible provider
SETTLARY_AI_BASE_URL=https://api.openai.com/v1
SETTLARY_AI_API_KEY=
SETTLARY_AI_MODEL=
`;
  }
  return `# Seller configuration
SELLER_ADDRESS=${config.payTo}
ARC_RPC_URL=https://rpc.testnet.arc.network
CHAIN_ID=5042002
`;
}
