import { NextResponse } from 'next/server';

import type { Article } from '@/content/articles';
import { requireApiAuth } from '@/lib/api-auth';
import { createArticle, getAllArticles, getArticle, searchArticles } from '@/lib/db';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';
import { validateArticle } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

function rateLimited(request: Request): NextResponse | null {
  const { limited, retryAfterSeconds } = checkRateLimit(clientKey(request));
  if (limited) {
    return NextResponse.json({ error: 'Too many requests' }, {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSeconds) },
    });
  }
  return null;
}

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q) {
    // Token-gated full-text search over every status (the management
    // surface). Returns full articles, ranked by relevance.
    if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { error: `Query must be between ${MIN_QUERY_LENGTH} and ${MAX_QUERY_LENGTH} characters` },
        { status: 400 },
      );
    }
    const rawLimit = url.searchParams.get('limit');
    const limit =
      rawLimit && Number.isInteger(Number(rawLimit))
        ? Math.min(Math.max(Number(rawLimit), 1), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const slugs = searchArticles(q, limit).map((r) => r.slug);
    const articles = slugs
      .map((slug) => getArticle(slug))
      .filter((a): a is Article => a !== undefined);
    return NextResponse.json({ articles });
  }

  return NextResponse.json({ articles: getAllArticles() });
}

export async function POST(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const denied = requireApiAuth(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = validateArticle(body, { requireSlug: false });
  if (!result.ok) {
    return NextResponse.json({ error: 'Validation failed', details: result.errors }, { status: 400 });
  }

  if (getArticle(result.value.slug)) {
    return NextResponse.json(
      { error: `An article with slug '${result.value.slug}' already exists` },
      { status: 409 },
    );
  }

  try {
    createArticle(result.value);
  } catch (error) {
    // Race between the existence check above and the insert: a concurrent
    // POST with the same slug loses the UNIQUE constraint. Surface it as a
    // clean 409 rather than a 500.
    const message = error instanceof Error ? error.message : '';
    if (message.includes('UNIQUE constraint failed: articles.slug')) {
      return NextResponse.json(
        { error: `An article with slug '${result.value.slug}' already exists` },
        { status: 409 },
      );
    }
    throw error;
  }
  return NextResponse.json({ article: getArticle(result.value.slug) }, { status: 201 });
}