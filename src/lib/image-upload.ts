import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

import sharp from 'sharp';

/**
 * Hero image ingestion: validate, resize, and (for URL sources) fetch safely.
 *
 * - Magic-byte validation rejects non-images before any processing (the
 *   Content-Type header is never trusted).
 * - sharp resizes to a bounded hero size and strips metadata (EXIF/GPS) by
 *   default — a privacy win for uploaded photos.
 * - URL fetching is SSRF-guarded: only http(s), private/loopback/link-local
 *   targets are rejected, redirects are followed manually so every hop is
 *   validated, and the connection is PINNED to the pre-validated IP (closing
 *   the DNS-rebinding resolve-then-fetch gap).
 */

/** Max width/height after resize — plenty for a 100vw × 120vh hero. */
export const MAX_HERO_DIMENSION = 1920;
/** Max bytes accepted from an upload or URL fetch (before resize). */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024; // 10 MB
/** Max pixels sharp will decode (decompression-bomb guard). */
const MAX_INPUT_PIXELS = 25_000_000; // ~25 MP
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

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

  let data: Buffer;
  try {
    data = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // honor EXIF orientation before stripping it
      .resize({ width: MAX_HERO_DIMENSION, height: MAX_HERO_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    // Decode can fail only after the metadata pass (e.g. a pixel-limit bomb
    // or corrupt data that surfaces during decode) — map to a clean 400.
    throw new ImageError('invalid or corrupt image', 400);
  }

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
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
      (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
      (a === 192 && b === 0 && parts[2] === 2) || // 192.0.2.0/24 TEST-NET-1
      (a === 198 && b === 51 && parts[2] === 100) || // 198.51.100.0/24 TEST-NET-2
      (a === 203 && b === 0 && parts[2] === 113) || // 203.0.113.0/24 TEST-NET-3
      a >= 224 // multicast 224.0.0.0/4 + reserved 240.0.0.0/4
    );
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    const bytes = ipv6ToBytes(lower);
    if (bytes) {
      // IPv4-mapped (::ffff:a.b.c.d) — first 10 bytes zero, then ff ff.
      if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
        return isPrivateIp(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
      }
      // IPv4-compatible (::a.b.c.d, dotted or hex) — first 12 bytes zero.
      if (bytes.slice(0, 12).every((b) => b === 0)) {
        return isPrivateIp(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
      }
    }
    return (
      lower === '::1' || // loopback
      lower === '::' || // unspecified
      lower.startsWith('fc') || lower.startsWith('fd') || // fc00::/7 unique local
      lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || // fe80::/10 link-local
      lower.startsWith('64:ff9b:') || // 64:ff9b::/96 NAT64 (embeds IPv4)
      lower.startsWith('ff') || // ff00::/8 multicast
      lower.startsWith('2001:db8:') // 2001:db8::/32 documentation
    );
  }
  return true; // not a valid IP — treat as private
}

/** Parse an IPv6 address into its 16 bytes, or null if malformed. */
function ipv6ToBytes(ip: string): number[] | null {
  let head = ip;
  let tail = '';
  const doubleColon = ip.indexOf('::');
  if (doubleColon !== -1) {
    head = ip.slice(0, doubleColon);
    tail = ip.slice(doubleColon + 2);
  }
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const groups = [...headParts, ...Array(missing).fill('0'), ...tailParts];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    const value = Number.parseInt(g, 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

/** Resolve a hostname and reject it if any address is private/loopback. */
async function resolvePublicAddress(hostname: string): Promise<string> {
  let addresses: string[];
  try {
    addresses = (await lookup(hostname, { all: true })).map((a) => a.address);
  } catch {
    throw new ImageError('could not resolve image host', 400);
  }
  if (addresses.length === 0) throw new ImageError('could not resolve image host', 400);
  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new ImageError('image URL resolves to a private or loopback address', 400);
    }
  }
  return addresses[0];
}

interface PinnedResponse {
  status: number;
  headers: IncomingMessage['headers'];
  body: Uint8Array;
}

/**
 * Fetch a URL with the connection PINNED to a pre-validated IP. The URL's
 * hostname is preserved (so TLS SNI + certificate validation still use the
 * real domain), but DNS resolution is overridden to return only the validated
 * address — closing the DNS-rebinding resolve-then-fetch gap. The body is
 * streamed with a hard byte cap and a timeout.
 */
function fetchPinned(url: URL, ip: string, timeoutMs: number): Promise<PinnedResponse> {
  const isHttps = url.protocol === 'https:';
  const request = isHttps ? httpsRequest : httpRequest;
  const family = isIP(ip) === 6 ? 6 : 4;

  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: { accept: 'image/*' },
        // Override DNS: always return the pre-validated address.
        lookup: (_hostname, _options, cb) => cb(null, ip, family),
      },
      (res) => {
        const chunks: Uint8Array[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_SOURCE_BYTES) {
            res.destroy();
            reject(new ImageError('image source exceeds 10 MB', 413));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const body = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.length;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
        res.on('error', (err) => reject(err));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request timed out')));
    req.on('error', (err) => reject(err));
    req.end();
  });
}

/**
 * Fetch an image URL with SSRF protection: http(s) only, private/loopback
 * targets rejected, the connection pinned to the validated IP (DNS-rebinding
 * safe), redirects followed manually with every hop validated, response size
 * capped while streaming, and a hard timeout.
 */
export async function fetchImageUrl(rawUrl: string): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageError('url must be a valid http(s) URL', 400);
  }

  let current: URL = url;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    // Validate the protocol on EVERY hop (redirects can change scheme).
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new ImageError('url must be an http(s) URL', 400);
    }

    const ip = await resolvePublicAddress(current.hostname);

    let res: PinnedResponse;
    try {
      res = await fetchPinned(current, ip, FETCH_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof ImageError) throw error;
      throw new ImageError('failed to fetch image URL', 400);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location) throw new ImageError('image URL redirect without a target', 400);
      try {
        current = new URL(location, current);
      } catch {
        throw new ImageError('invalid redirect target', 400);
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      throw new ImageError(`image URL returned HTTP ${res.status}`, 400);
    }
    return res.body;
  }
  throw new ImageError('too many redirects', 400);
}