import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/lib/api-auth';
import { updateFeedbackStatus, type FeedbackStatus } from '@/lib/db';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/read-body';

export const dynamic = 'force-dynamic';

const FEEDBACK_STATUSES: FeedbackStatus[] = ['new', 'acknowledged', 'archived'];

// The body is a single { status } field — a tiny cap is plenty.
const MAX_BODY_BYTES = 1_024;

/**
 * Update a feedback submission's status — token-gated. Body: { status }.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth first: unauthenticated requests must not consume the per-IP bucket.
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const { limited, retryAfterSeconds } = checkRateLimit(clientKey(request));
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'id must be a positive integer' }, { status: 400 });
  }

  const bodyResult = await readJsonBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json(
      { error: bodyResult.error === 'too-large' ? 'Request body too large' : 'Invalid JSON body' },
      { status: bodyResult.error === 'too-large' ? 413 : 400 },
    );
  }
  const body = bodyResult.value;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 });
  }
  const status = (body as Record<string, unknown>).status;
  if (typeof status !== 'string' || !FEEDBACK_STATUSES.includes(status as FeedbackStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${FEEDBACK_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }

  const feedback = updateFeedbackStatus(id, status as FeedbackStatus);
  if (!feedback) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ feedback });
}