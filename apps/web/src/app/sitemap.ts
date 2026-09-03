import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const site = 'https://voiceout.xyz';
  const now = new Date();
  return [
    { url: site, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: `${site}/trending`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${site}/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${site}/register`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${site}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${site}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
