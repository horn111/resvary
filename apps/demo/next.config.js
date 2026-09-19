/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['viem', 'pg', '@resvary/sqlite', '@resvary/postgres'],
};

module.exports = nextConfig;
