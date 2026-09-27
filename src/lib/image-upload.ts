import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import sharp from 'sharp';

/**
 * Hero image ingestion: validate, resize, and (for URL sources) fetch safely.
 *
 * - Magic-byte validation rejects non-images before any processing (the
 *   Content-Type header is never trusted).
 * - sharp resizes to a bounded hero size and strips metadata (EXIF/GPS) by
 *   default — a privacy win for uploaded photos.
 * - URL fetching is SSRF-guarded: only http(s), private/loopback/link-local
 *   targets are rejected, and redirects are followed manually so every hop
 *   is validated.
 */

/** Max width/height after resize — plenty for a 100vw × 120vh hero. */
export const MAX_HERO_DIMENSION = 1920;
/** Max bytes accepted from an upload or URL fetch (before resize). */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024; // 10 MB
/** Max pixels sharp will decode (decompression-bomb guard). */
const MAX_INPUT_PIXELS = 40_000_000; // ~40 MP
const FETCH_TIMEOUT_MS = 10_000;

export interface ProcessedImage {
  data: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/** Detect the image format from magic bytes. Returns null for non-images. */
export function detectImageType(buf: Uint8Array): { format: string; contentType: string } | null {
  if (buf.length < 12) return null;
  const b = buf;
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { format: 'jpeg', contentType: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { format: 'png', contentType: 'image/png' };
  }
  // GIF: GIF8
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return { format: 'gif', contentType: 'image/gif' };
  }
  // WebP: RIFF....WEBP
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { format: 'webp', contentType: 'image/webp' };
  }
  // AVIF: ....ftypavif / ftypavis (brand at offset 8)
  if (
    b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
    ((b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) ||
      (b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x73))
  ) {
    return { format: 'avif', contentType: 'image/avif' };
  }
  return null;
}

/**
 * Validate + resize an image buffer. Rejects non-images, oversized sources,
 * and decompression bombs. Output is bounded to MAX_HERO_DIMENSION on the
 * longest edge, re-encoded to webp (good quality/size tradeoff), and stripped
 * of metadata.
 */
export async function processImage(buf: Uint8Array): Promise<ProcessedImage> {
  if (buf.length === 0) throw new ImageError('empty image body', 400);
  if (buf.length > MAX_SOURCE_BYTES) {
    throw new ImageError(`image source exceeds ${MAX_SOURCE_BYTES} bytes`, 413);
  }
  const detected = detectImageType(buf);
  if (!detected) throw new ImageError('unsupported or invalid image (expected jpeg/png/webp/gif/avif)', 415);

  let metadata;
  try {
    metadata = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ImageError('invalid or corrupt image', 400);
  }
  if (!metadata.width || !metadata.height) {
    throw new ImageError('could not read image dimensions', 400);
  }

  const data = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // honor EXIF orientation before stripping it
    .resize({ width: MAX_HERO_DIMENSION, height: MAX_HERO_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const out = await sharp(data).metadata();
  return {
    data,
    contentType: 'image/webp',
    width: out.width ?? metadata.width,
    height: out.height ?? metadata.height,
    sizeBytes: data.length,
  };
}

/** Error with an HTTP status code, for direct mapping in route handlers. */
export class ImageError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// SSRF-guarded URL fetch
// ---------------------------------------------------------------------------

/** True when the IP is private, loopback, link-local, or otherwise unroutable. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    return (
      a === 10 || // 10.0.0.0/8
      a === 127 || // loopback
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 169 && b === 254) || // link-local
      a === 0 || // 0.0.0.0/8
      (a === 100 && b >= 64 && b <= 127) // 100.64.0.0/10 CGNAT
    );
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' || // loopback
      lower === '::' || // unspecified
      lower.startsWith('fc') || lower.startsWith('fd') || // fc00::/7 unique local
      lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || // fe80::/10 link-local
      lower.startsWith('::ffff:') // IPv4-mapped (checked against the v4 rules below)
    );
  }
  return true; // not a valid IP — treat as private
}

/** Resolve a hostname and reject it if any address is private/loopback. */
async function assertPublicHost(hostname: string): Promise<void> {
  let addresses: string[];
  try {
    addresses = (await lookup(hostname, { all: true })).map((a) => a.address);
  } catch {
    throw new ImageError('could not resolve image host', 400);
  }
  if (addresses.length === 0) throw new ImageError('could not resolve image host', 400);
  for (const addr of addresses) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded v4 address.
    const v4 = addr.toLowerCase().startsWith('::ffff:') ? addr.slice(7) : addr;
    if (isPrivateIp(v4)) {
      throw new ImageError('image URL resolves to a private or loopback address', 400);
    }
  }
}

/**
 * Fetch an image URL with SSRF protection: http(s) only, private/loopback
 * targets rejected, redirects followed manually so every hop is validated,
 * response size capped, and a hard timeout.
 */
export async function fetchImageUrl(rawUrl: string): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageError('url must be a valid http(s) URL', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImageError('url must be an http(s) URL', 400);
  }

  let current: URL = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'image/*' },
      });
    } catch {
      throw new ImageError('failed to fetch image URL', 400);
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new ImageError('image URL redirect without a target', 400);
      current = new URL(location, current);
      continue;
    }
    if (!res.ok) throw new ImageError(`image URL returned HTTP ${res.status}`, 400);

    const contentLength = Number(res.headers.get('content-length') ?? 0);
    if (contentLength > MAX_SOURCE_BYTES) throw new ImageError('image source exceeds 10 MB', 413);

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_SOURCE_BYTES) throw new ImageError('image source exceeds 10 MB', 413);
    return buf;
  }
  throw new ImageError('too many redirects', 400);
}