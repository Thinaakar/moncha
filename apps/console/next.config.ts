import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // Standalone tracing symlinks pnpm packages, which Windows blocks without Developer Mode; the Docker build is Linux.
  output: process.platform === 'win32' ? undefined : 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@moncha/contracts'],
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/favicon.ico', destination: '/icon.svg' }];
  },
  async headers() {
    return [
      {
        // Website copy files set their own headers in the proxy (they are framed by the preview).
        source: '/:path((?!api/proxy/site-files/).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
