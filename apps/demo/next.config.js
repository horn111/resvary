/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['viem', '@settlary/sqlite'],
};

module.exports = nextConfig;
