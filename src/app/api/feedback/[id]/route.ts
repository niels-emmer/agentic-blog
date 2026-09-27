import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/lib/api-auth';
import { updateFeedbackStatus, type FeedbackStatus } from '@/lib/db';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const FEEDBACK_STATUSES: FeedbackStatus[] = ['new', 'acknowledged', 'archived'];

/**
 * Update a feedback submission's status — token-gated. Body: { status }.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { limited, retryAfterSeconds } = checkRateLimit(clientKey(request));
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: 'id must be a positive integer' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
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