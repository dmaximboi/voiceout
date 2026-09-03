import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/settings', '/record', '/switch-acct', '/vo-api/', '/me'],
      },
    ],
    sitemap: 'https://voiceout.xyz/sitemap.xml',
    host: 'https://voiceout.xyz',
  };
}
