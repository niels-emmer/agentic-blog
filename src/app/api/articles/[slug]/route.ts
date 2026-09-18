import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/lib/api-auth';
import { deleteArticle, getArticle, updateArticle } from '@/lib/db';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';
import { validateArticle } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ slug: string }> };

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

export async function GET(request: Request, { params }: RouteContext) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ article });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const { slug } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = validateArticle(body, { requireSlug: true });
  if (!result.ok) {
    return NextResponse.json({ error: 'Validation failed', details: result.errors }, { status: 400 });
  }

  // Full-replace semantics: the URL slug is authoritative; the body slug must
  // match it (the repository re-inserts under the URL slug).
  if (result.value.slug !== slug) {
    return NextResponse.json(
      { error: `Body slug '${result.value.slug}' does not match URL slug '${slug}'` },
      { status: 400 },
    );
  }

  const updated = updateArticle(slug, result.value);
  if (!updated) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ article: getArticle(slug) });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const { slug } = await params;
  const deleted = deleteArticle(slug);
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}