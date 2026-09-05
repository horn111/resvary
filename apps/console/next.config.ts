import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  agentRules: false,
  serverExternalPackages: ['@resvary/sqlite', '@resvary/postgres', 'pg'],
};

export default nextConfig;
