import type { Article } from '@/content/articles';
import type { SiteConfig } from '@/lib/db';

/**
 * RSS 2.0 feed generation. Pure function so it is unit-testable without a
 * running server. The feed is config-gated: the route returns 404 unless
 * `feedEnabled` is true (default off).
 */

function escapeXml(value: string): string {
  // Strip XML 1.0 forbidden control characters (illegal even as character
  // references) before escaping the five XML specials.
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** `logged` is a human-readable date ("4 Sep 2026"); best-effort RFC 822. */
function toRfc822(logged: string): string | undefined {
  const parsed = Date.parse(logged);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toUTCString();
}

export function generateFeedXml(articles: Article[], config: SiteConfig): string {
  const baseUrl = config.siteUrl.replace(/\/$/, '');
  const items = articles
    .map((article) => {
      const link = `${baseUrl}/articles/${encodeURIComponent(article.slug)}`;
      const pubDate = toRfc822(article.logged);
      const body = article.sections
        .map(
          (section) =>
            `<h3>${escapeXml(section.heading)}</h3>` +
            section.paragraphs.map((p) => `<p>${escapeXml(p)}</p>`).join(''),
        )
        .join('');
      return [
        '    <item>',
        `      <title>${escapeXml(article.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        ...(pubDate ? [`      <pubDate>${pubDate}</pubDate>`] : []),
        `      <description>${escapeXml(article.dek)}</description>`,
        `      <content:encoded><![CDATA[${body}]]></content:encoded>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '  <channel>',
    `    <title>${escapeXml(config.siteTitle)}</title>`,
    `    <link>${escapeXml(baseUrl)}</link>`,
    `    <description>${escapeXml(config.siteDescription)}</description>`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}