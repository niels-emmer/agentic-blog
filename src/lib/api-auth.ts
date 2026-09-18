import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * Constant-time comparison of two strings (lengths equalized via SHA-256 so
 * timingSafeEqual never throws on length mismatch).
 */
function safeEqual(a: string, b: string): boolean {
  const aDigest = createHash('sha256').update(a).digest();
  const bDigest = createHash('sha256').update(b).digest();
  return timingSafeEqual(aDigest, bDigest);
}

/**
 * Bearer-token gate for the content API.
 *
 * All content API routes require `Authorization: Bearer <CONTENT_API_TOKEN>`.
 * If the token env var is unset the API is disabled entirely (503) rather
 * than falling open — the VPS is internet-facing even though the site is
 * unindexed, so the write path must never be reachable without a secret.
 */
export function requireApiAuth(request: Request): NextResponse | null {
  const token = process.env.CONTENT_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: 'Content API is not configured (CONTENT_API_TOKEN is unset)' },
      { status: 503 },
    );
  }
  const auth = request.headers.get('authorization');
  if (!auth || !safeEqual(auth, `Bearer ${token}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}