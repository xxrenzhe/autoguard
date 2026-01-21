/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // Required for Docker deployment
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  async rewrites() {
    return [
      // SystemDesign2: expose APIs under /api/v1/*
      { source: '/api/v1/:path*', destination: '/api/:path*' },
    ];
  },
};

module.exports = nextConfig;
