import type { ProjectConfig } from '../prompts.js';

export function envTemplate(config: ProjectConfig): string {
  return `# Seller configuration
SELLER_ADDRESS=${config.payTo}
ARC_RPC_URL=https://rpc.testnet.arc.network
CHAIN_ID=5042002
`;
}
