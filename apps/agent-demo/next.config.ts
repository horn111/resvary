import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';
import { posix, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { nodeFileTrace } from '@vercel/nft';
const config: NextConfig = {
  agentRules: false,
  env: {
    RESVARY_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RESVARY_BUILD_SHA ?? '',
  },
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
  // Keep Turbopack's globs small without including untraced source maps.
  const includeFiles: string[] = [];
  const includeGroups = new Map<
    string,
    { directory: string; extension: string; files: string[] }
  >();
  for (const tracedFile of traced.fileList) {
    const file = tracedFile.replaceAll('\\', '/');
    const extension = posix.extname(file);
    if (!file.startsWith('node_modules/') || !extension) {
      includeFiles.push(`../../${file}`);
      continue;
    }

    const directory = posix.dirname(file);
    const key = `${directory}\0${extension}`;
    const group = includeGroups.get(key) ?? { directory, extension, files: [] };
    group.files.push(file);
    includeGroups.set(key, group);
  }
  for (const group of includeGroups.values()) {
    includeFiles.push(
      group.files.length > 1
        ? `../../${group.directory}/*${group.extension}`
        : `../../${group.files[0]}`,
    );
  }
  const wrapped = withWorkflow(
    {
      ...config,
      outputFileTracingIncludes: { '/*': includeFiles },
    },
    { workflows: { local: { port: 3100 } } },
  );
  return typeof wrapped === 'function' ? wrapped(phase, context) : wrapped;
}
