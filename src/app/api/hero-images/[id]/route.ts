import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/lib/api-auth';
import { deleteHeroImage } from '@/lib/db';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Remove a hero image from the rotation stack. Token-gated. Irreversible.
 */
export async function DELETE(
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

  if (!deleteHeroImage(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}