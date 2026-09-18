import type { MetadataRoute } from 'next';

import { getSiteConfig } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * robots.txt driven by the site config's robotsIndex toggle. When indexing is
 * off (the default — private posture) the site is fully disallowed; flipping
 * robotsIndex=true allows crawling.
 */
export default function robots(): MetadataRoute.Robots {
  const config = getSiteConfig();
  return {
    rules: {
      userAgent: '*',
      ...(config.robotsIndex ? { allow: '/' } : { disallow: '/' }),
    },
  };
}