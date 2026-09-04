import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dir, '../..');

function extraDevOrigins() {
  const hosts = ['*.trycloudflare.com'];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const nic of addrs ?? []) {
      if (nic.family === 'IPv4' && !nic.internal) hosts.push(nic.address);
    }
  }
  return hosts;
}

const nextConfig: NextConfig = {
  transpilePackages: ['@voiceout/shared'],
  output: 'standalone',
  poweredByHeader: false,
  outputFileTracingRoot: repoRoot,
  allowedDevOrigins: extraDevOrigins(),
  turbopack: {
    root: repoRoot,
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://telegram.org https://t.me; media-src 'self' blob:; connect-src 'self' blob: ws: wss: https://oauth.telegram.org; font-src 'self' data:; worker-src 'self' blob:; frame-src https://oauth.telegram.org https://telegram.org; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [{ source: '/auth/:path*', destination: '/vo-api/auth/:path*' }];
  },
};

export default nextConfig;
