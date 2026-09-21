import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: [
    '@moncha/db',
    '@moncha/domain',
    '@moncha/contracts',
    '@moncha/integrations',
    '@moncha/crawling',
  ],
  async rewrites() {
    return [{ source: '/v1/:path*', destination: '/api/v1/:path*' }];
  },
};

export default config;
