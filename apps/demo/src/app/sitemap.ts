import type { MetadataRoute } from 'next';
import { SITE_LAST_MODIFIED, SITE_URL } from './site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: SITE_LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 1,
      images: [`${SITE_URL}/og/resvary-social-card.png`],
    },
    {
      url: `${SITE_URL}/pricing.md`,
      lastModified: SITE_LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];
}
