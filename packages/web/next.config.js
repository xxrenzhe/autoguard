/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // Required for Docker deployment
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
};

module.exports = nextConfig;
