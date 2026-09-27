import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/lib/api-auth';
import { createFeedback, getArticle, listFeedback, type FeedbackStatus } from '@/lib/db';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/read-body';
import { validateFeedback } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const FEEDBACK_STATUSES: FeedbackStatus[] = ['new', 'acknowledged', 'archived'];

// Stricter than the general API limit: submissions are human-scale, and the
// endpoint is public, so a tight per-IP cap is the first spam barrier.
const FEEDBACK_MAX_PER_WINDOW = 5;
const FEEDBACK_WINDOW_MS = 600_000; // 10 minutes

const MAX_BODY_BYTES = 64_000;

/**
 * Public feedback submission — the only unauthenticated write on the site.
 * Spam controls: honeypot field (silently accepted, never stored) + strict
 * per-IP rate limit. The body is validated and size-capped before storage.
 */
export async function POST(request: Request) {
  const { limited, retryAfterSeconds } = checkRateLimit(clientKey(request), {
    max: FEEDBACK_MAX_PER_WINDOW,
    windowMs: FEEDBACK_WINDOW_MS,
  });
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  // Reject non-JSON content types: cross-origin `text/plain` fetches are
  // CORS-safelisted (no preflight) and would otherwise be accepted. Requiring
  // application/json forces a preflight the server never answers. Exact match
  // (allowing the charset parameter) so `application/json-patch+json` and
  // similar vendor types are not accepted.
  const contentType = request.headers.get('content-type') ?? '';
  const normalized = contentType.toLowerCase();
  if (normalized !== 'application/json' && !normalized.startsWith('application/json;')) {
    return NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 });
  }

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json(
      { error: bodyResult.error === 'too-large' ? 'Request body too large' : 'Invalid JSON body' },
      { status: bodyResult.error === 'too-large' ? 413 : 400 },
    );
  }
  const body = bodyResult.value;

  // Honeypot: a real browser never fills `website` (it is hidden). Bots do.
  // Silently accept so the bot cannot tell it was caught — and store nothing.
  // Any non-empty value of any type counts as a bot.
  const website =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).website
      : undefined;
  if (website !== undefined && website !== null && website !== '') {
    return NextResponse.json({ ok: true });
  }

  const result = validateFeedback(body);
  if (!result.ok) {
    return NextResponse.json({ error: 'Validation failed', details: result.errors }, { status: 400 });
  }

  // The feedback table's article_slug FK rejects slugs that don't exist in
  // `articles`. Rather than surface a 500 (or a 400 that doubles as a
  // slug-existence oracle), drop the association and store the feedback
  // alone — the message is the content, and the FK already tolerates missing
  // articles at read time (ON DELETE SET NULL). The response is uniformly
  // 201 for every valid submission.
  const value = result.value;
  if (value.articleSlug !== undefined && !getArticle(value.articleSlug)) {
    value.articleSlug = undefined;
  }

  const feedback = createFeedback(value);
  return NextResponse.json({ ok: true, id: feedback.id }, { status: 201 });
}

/**
 * List feedback submissions — token-gated. Optional `status` filter and
 * `limit` (1–100, default 50). Uses the default rate limit: the endpoint is
 * already authenticated, so the strict public-submission cap does not apply
 * (it would lock out the operator's own MCP tooling).
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

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get('status');
  const status = rawStatus === null ? undefined : rawStatus;
  if (status !== undefined && !FEEDBACK_STATUSES.includes(status as FeedbackStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${FEEDBACK_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }

  const rawLimit = Number(url.searchParams.get('limit') ?? 50);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;

  return NextResponse.json({ feedback: listFeedback({ status: status as FeedbackStatus | undefined, limit }) });
}