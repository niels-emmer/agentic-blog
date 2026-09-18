import { NextResponse } from 'next/server';

import { requireApiAuth } from '@/lib/api-auth';
import { importArticles, updateSiteConfig } from '@/lib/db';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/read-body';
import { validateArticle, validateSiteConfig } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * Content import with merge-by-slug semantics.
 *
 * Body: { articles: Article[], siteConfig?: object, deleteMissing?: boolean }
 *
 * - Every entry is validated through the same validator as the content API;
 *   if any entry fails, the whole import is rejected (400) and nothing is
 *   written (the repository import is transactional).
 * - Existing slugs are full-replaced; new slugs are created.
 * - Nothing is deleted unless `deleteMissing: true` is explicitly set, in
 *   which case DB entries absent from the import are removed.
 * - `siteConfig` (optional) is a partial config patch applied after the
 *   entries, through the same validation as PATCH /api/site-config.
 */
export async function POST(request: Request) {
  const { limited, retryAfterSeconds } = checkRateLimit(clientKey(request));
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
    );
  }
  const denied = requireApiAuth(request);
  if (denied) return denied;

  // Reject oversized bodies up front (imports can legitimately be large, but
  // unbounded bodies are a memory-exhaustion vector; 5 MB is generous for a
  // text-only content dump). The cap is enforced while streaming, so a
  // client cannot bypass it by omitting or faking Content-Length.
  const bodyResult = await readJsonBody(request, 5_000_000);
  if (!bodyResult.ok) {
    if (bodyResult.error === 'too-large') {
      return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
    }
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const body = bodyResult.value;

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 });
  }
  const o = body as Record<string, unknown>;

  if (!Array.isArray(o.articles)) {
    return NextResponse.json({ error: 'articles must be an array' }, { status: 400 });
  }
  if (o.articles.length > 1_000) {
    return NextResponse.json({ error: 'articles must have at most 1000 entries' }, { status: 400 });
  }

  // Validate every entry up front so a bad entry rejects the whole import.
  const entries = [];
  for (const raw of o.articles) {
    const result = validateArticle(raw, { requireSlug: true });
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Validation failed', details: result.errors },
        { status: 400 },
      );
    }
    entries.push(result.value);
  }

  let siteConfigPatch: Parameters<typeof updateSiteConfig>[0] | undefined;
  if (o.siteConfig !== undefined) {
    const configResult = validateSiteConfig(o.siteConfig);
    if (!configResult.ok) {
      return NextResponse.json(
        { error: 'Validation failed', details: configResult.errors },
        { status: 400 },
      );
    }
    siteConfigPatch = configResult.value;
  }

  const deleteMissing = o.deleteMissing === true;

  const summary = importArticles(entries, { deleteMissing });
  if (siteConfigPatch) {
    try {
      updateSiteConfig(siteConfigPatch);
    } catch (error) {
      // The entries are already committed (separate transaction). Report the
      // partial state explicitly so the client can retry the config patch.
      console.error('Import committed but siteConfig patch failed:', error);
      return NextResponse.json(
        { error: 'Articles imported, but the siteConfig patch failed', imported: true, summary },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, summary });
}