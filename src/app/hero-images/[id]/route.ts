import { NextResponse } from 'next/server';

import { getHeroImage } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Public hero image bytes. Served to browsers as the page background; the
 * management surface (upload/list/delete) is token-gated under /api/hero-images.
 * Images are immutable once stored, so the cache header is long-lived.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    return new NextResponse('Not found', { status: 404 });
  }

  const image = getHeroImage(id);
  if (!image) {
    return new NextResponse('Not found', { status: 404 });
  }

  return new NextResponse(Buffer.from(image.data), {
    headers: {
      'Content-Type': image.contentType,
      'Content-Length': String(image.sizeBytes),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}