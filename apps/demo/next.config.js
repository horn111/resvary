/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    RESVARY_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RESVARY_BUILD_SHA ?? '',
  },
  serverExternalPackages: ['viem', 'pg', '@resvary/sqlite', '@resvary/postgres'],
};

module.exports = nextConfig;
