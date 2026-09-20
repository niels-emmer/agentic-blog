import { NextResponse } from 'next/server';

import { searchArticles } from '@/lib/db';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

/**
 * Public full-text search over published articles (titles, deks, bodies,
 * tags, agent notes). Unlike the content API this route is unauthenticated by
 * design — it serves site readers, and returns only published articles with
 * the same fields the public pages already render. Rate-limited like the
 * content API, but on a separate bucket (`search:` prefix) so reader traffic
 * can never exhaust the management API's quota.
 */
export async function GET(request: Request) {
  const { limited, retryAfterSeconds } = checkRateLimit(`search:${clientKey(request)}`);
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Query must be at least ${MIN_QUERY_LENGTH} characters` },
      { status: 400 },
    );
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Query must be at most ${MAX_QUERY_LENGTH} characters` },
      { status: 400 },
    );
  }

  const rawLimit = url.searchParams.get('limit');
  const limit =
    rawLimit && Number.isInteger(Number(rawLimit))
      ? Math.min(Math.max(Number(rawLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

  return NextResponse.json({ query: q, results: searchArticles(q, limit, { publishedOnly: true }) });
}