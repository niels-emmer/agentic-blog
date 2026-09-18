import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/lib/api-auth';
import { createArticle, getAllArticles, getArticle } from '@/lib/db';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';
import { validateArticle } from '@/lib/validation';

export const dynamic = 'force-dynamic';

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