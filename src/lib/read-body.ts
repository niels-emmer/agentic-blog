/**
 * Reads a JSON request body with a hard byte cap enforced while streaming,
 * so a client cannot bypass the cap by omitting or faking Content-Length
 * (chunked transfer, false header). Mirrors the MCP server's approach.
 *
 * Returns:
 *   { ok: true, value }                  — parsed JSON body
 *   { ok: false, error: 'too-large' }    — body exceeded maxBytes
 *   { ok: false, error: 'invalid-json' } — body was not valid JSON
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; error: 'too-large' | 'invalid-json' }> {
  // Fast path: a truthful Content-Length over the cap is rejected without
  // reading anything.
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maxBytes) return { ok: false, error: 'too-large' };

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, error: 'invalid-json' };

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, error: 'too-large' };
    }
    chunks.push(value);
  }

  const text = Buffer.concat(chunks).toString('utf-8');
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
}

/**
 * Reads a raw request body (binary) with a hard byte cap enforced while
 * streaming. Returns the bytes, or `{ ok: false, error: 'too-large' }` when
 * the cap is exceeded. Used for binary image uploads.
 */
export async function readBodyBytes(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: Uint8Array } | { ok: false; error: 'too-large' }> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maxBytes) return { ok: false, error: 'too-large' };

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, error: 'too-large' };

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, error: 'too-large' };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { ok: true, value: merged };
}