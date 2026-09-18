import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/lib/api-auth';
import { getAllArticles, getSiteConfig } from '@/lib/db';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Full content export: every article plus the site config, as JSON.
 * The output of this endpoint is the input to POST /api/import, so the
 * round-trip is byte-identical.
 */
export async function GET(request: Request) {
  const { limited, retryAfterSeconds } = checkRateLimit(clientKey(request));
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }
  const denied = requireApiAuth(request);
  if (denied) return denied;

  return NextResponse.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    articles: getAllArticles(),
    siteConfig: getSiteConfig(),
  });
}