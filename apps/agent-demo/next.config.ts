import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { nodeFileTrace } from '@vercel/nft';
const config: NextConfig = {
  agentRules: false,
  outputFileTracingRoot: resolve(process.cwd(), '../..'),
  serverExternalPackages: ['pg', '@resvary/postgres', '@resvary/circle', '@resvary/sdk'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default async function nextConfig(phase: string, context: { defaultConfig: NextConfig }) {
  // Circle remains a standalone Node executable. Trace on the target OS so its
  // optional native bindings and transitive dependencies survive serverless packaging.
  const require = createRequire(import.meta.url);
  const traced = await nodeFileTrace([require.resolve('@circle-fin/cli')], {
    base: resolve(process.cwd(), '../..'),
    processCwd: process.cwd(),
  });
  const files = [...traced.fileList].map((file) => `../../${file.replaceAll('\\', '/')}`);
  const wrapped = withWorkflow(
    {
      ...config,
      outputFileTracingIncludes: { '/*': files },
    },
    { workflows: { local: { port: 3100 } } },
  );
  return typeof wrapped === 'function' ? wrapped(phase, context) : wrapped;
}
