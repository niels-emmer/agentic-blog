import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/lib/api-auth';
import { getSiteConfig, updateSiteConfig } from '@/lib/db';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/read-body';
import { validateSiteConfig } from '@/lib/validation';

export const dynamic = 'force-dynamic';

function rateLimited(request: Request): NextResponse | null {
  const { limited, retryAfterSeconds } = checkRateLimit(clientKey(request));
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }
  return null;
}

export async function GET(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const denied = requireApiAuth(request);
  if (denied) return denied;
  return NextResponse.json({ siteConfig: getSiteConfig() });
}

export async function PATCH(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  const denied = requireApiAuth(request);
  if (denied) return denied;

  // Reject oversized bodies (the largest valid config payload is a few KB;
  // 64 KB is generous headroom). The cap is enforced while streaming, so a
  // client cannot bypass it by omitting or faking Content-Length.
  const bodyResult = await readJsonBody(request, 64_000);
  if (!bodyResult.ok) {
    if (bodyResult.error === 'too-large') {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const body = bodyResult.value;

  const result = validateSiteConfig(body);
  if (!result.ok) {
    return NextResponse.json({ error: 'Validation failed', details: result.errors }, { status: 400 });
  }

  const siteConfig = updateSiteConfig(result.value);
  return NextResponse.json({ siteConfig });
}