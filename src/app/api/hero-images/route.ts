import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/lib/api-auth';
import { createHeroImage, listHeroImages } from '@/lib/db';
import { fetchImageUrl, ImageError, MAX_SOURCE_BYTES, processImage } from '@/lib/image-upload';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';
import { readBodyBytes, readJsonBody } from '@/lib/read-body';

export const dynamic = 'force-dynamic';

// base64 of a MAX_SOURCE_BYTES image is ~1.33x the bytes; allow headroom.
const MAX_JSON_BODY_BYTES = Math.ceil(MAX_SOURCE_BYTES * 1.4);

/** Sanitize a source name to a safe, bounded label. */
function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (cleaned || 'hero-image').slice(0, 100);
}

/**
 * Add a hero image to the rotation stack. Token-gated. Three input modes:
 *
 * - Raw binary upload: `Content-Type: image/*` with the image bytes as the
 *   body.
 * - URL: JSON `{ "url": "https://…" }` — the server fetches it (SSRF-guarded).
 * - Base64: JSON `{ "data": "<base64>", "name": "optional" }` — for JSON-only
 *   transports (e.g. MCP).
 *
 * Every source is magic-byte validated, resized to ≤1920px on the longest
 * edge, re-encoded to webp, and stripped of metadata before storage.
 */
export async function POST(request: Request) {
  // Auth first: unauthenticated requests must not consume the per-IP bucket
  // (an attacker sharing the operator's client key could exhaust it).
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const { limited, retryAfterSeconds } = checkRateLimit(clientKey(request));
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  const contentType = request.headers.get('content-type') ?? '';
  const normalized = contentType.toLowerCase();

  let source: Uint8Array;
  let name = 'hero-image';

  if (normalized.startsWith('image/')) {
    // Raw binary upload.
    const body = await readBodyBytes(request, MAX_SOURCE_BYTES);
    if (!body.ok) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    source = body.value;
  } else if (normalized === 'application/json' || normalized.startsWith('application/json;')) {
    const bodyResult = await readJsonBody(request, MAX_JSON_BODY_BYTES);
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
    const o = body as Record<string, unknown>;

    if (typeof o.url === 'string') {
      try {
        source = await fetchImageUrl(o.url);
      } catch (error) {
        if (error instanceof ImageError) {
          return NextResponse.json({ error: error.message }, { status: error.status });
        }
        throw error;
      }
      try {
        name = sanitizeName(new URL(o.url).pathname.split('/').pop() ?? 'hero-image');
      } catch {
        name = 'hero-image';
      }
    } else if (typeof o.data === 'string') {
      try {
        source = new Uint8Array(Buffer.from(o.data, 'base64'));
      } catch {
        return NextResponse.json({ error: 'data must be valid base64' }, { status: 400 });
      }
      if (typeof o.name === 'string' && o.name.trim()) name = sanitizeName(o.name);
    } else {
      return NextResponse.json(
        { error: 'body must contain a "url" or a base64 "data" field' },
        { status: 400 },
      );
    }
  } else {
    return NextResponse.json(
      { error: 'Content-Type must be image/* or application/json' },
      { status: 415 },
    );
  }

  let processed;
  try {
    processed = await processImage(source);
  } catch (error) {
    if (error instanceof ImageError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const heroImage = createHeroImage({ name, ...processed });
  return NextResponse.json({ heroImage }, { status: 201 });
}

/** List hero image metadata (no blobs). Token-gated. */
export async function GET(request: Request) {
  const denied = requireApiAuth(request);
  if (denied) return denied;

  const { limited, retryAfterSeconds } = checkRateLimit(clientKey(request));
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }

  return NextResponse.json({ heroImages: listHeroImages() });
}