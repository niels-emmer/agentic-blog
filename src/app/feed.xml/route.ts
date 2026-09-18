import { getAllArticles, getSiteConfig } from '@/lib/db';
import { generateFeedXml } from '@/lib/feed';

export const dynamic = 'force-dynamic';

/**
 * RSS 2.0 feed, config-gated by `feedEnabled` (default off). Returns 404 when
 * disabled so the endpoint doesn't advertise itself. Only published articles
 * are included.
 */
export async function GET() {
  const config = getSiteConfig();
  if (!config.feedEnabled) {
    return new Response('Not found', { status: 404 });
  }
  const published = getAllArticles().filter((article) => article.status === 'published');
  const xml = generateFeedXml(published, config);
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}