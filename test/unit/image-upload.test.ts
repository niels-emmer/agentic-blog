import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  detectImageType,
  fetchImageUrl,
  ImageError,
  isPrivateIp,
  processImage,
} from '@/lib/image-upload';

// ---------------------------------------------------------------------------
// detectImageType
// ---------------------------------------------------------------------------

test('detectImageType recognizes jpeg/png/webp/gif/avif magic bytes', async () => {
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
  const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } }).webp().toBuffer();
  const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } }).gif().toBuffer();
  const avif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } }).avif().toBuffer();

  assert.equal(detectImageType(png)?.contentType, 'image/png');
  assert.equal(detectImageType(jpeg)?.contentType, 'image/jpeg');
  assert.equal(detectImageType(webp)?.contentType, 'image/webp');
  assert.equal(detectImageType(gif)?.contentType, 'image/gif');
  assert.equal(detectImageType(avif)?.contentType, 'image/avif');
});

test('detectImageType rejects non-images', () => {
  assert.equal(detectImageType(Buffer.from('hello world this is not an image')), null);
  assert.equal(detectImageType(Buffer.from('')), null);
  assert.equal(detectImageType(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b])), null);
});

// ---------------------------------------------------------------------------
// processImage
// ---------------------------------------------------------------------------

test('processImage resizes, re-encodes to webp, and strips metadata', async () => {
  // A 64x32 PNG with an EXIF orientation marker (6 = rotate 90° CW). The
  // .rotate() step honors it, so the output is 32x64 — and the orientation
  // metadata itself is stripped.
  const src = await sharp({
    create: { width: 64, height: 32, channels: 3, background: '#336699' },
  })
    .withMetadata({ orientation: 6 })
    .png()
    .toBuffer();

  const out = await processImage(src);
  assert.equal(out.contentType, 'image/webp');
  assert.equal(out.width, 32);
  assert.equal(out.height, 64);
  assert.ok(out.sizeBytes > 0);

  const meta = await sharp(out.data).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.orientation, undefined, 'EXIF orientation must be stripped');
});

test('processImage downscales oversized images to the max dimension', async () => {
  const src = await sharp({
    create: { width: 4000, height: 2000, channels: 3, background: '#224466' },
  })
    .png()
    .toBuffer();

  const out = await processImage(src);
  assert.ok(out.width <= 1920, `width ${out.width} should be ≤ 1920`);
  assert.ok(out.height <= 1920, `height ${out.height} should be ≤ 1920`);
  // Aspect ratio preserved: 4000x2000 → 1920x960.
  assert.equal(out.width, 1920);
  assert.equal(out.height, 960);
});

test('processImage rejects non-image bytes with 415', async () => {
  await assert.rejects(
    () => processImage(Buffer.from('definitely not an image at all')),
    (e: unknown) => e instanceof ImageError && e.status === 415,
  );
});

test('processImage rejects an empty body with 400', async () => {
  await assert.rejects(
    () => processImage(Buffer.alloc(0)),
    (e: unknown) => e instanceof ImageError && e.status === 400,
  );
});

test('processImage rejects oversized sources with 413', async () => {
  const big = Buffer.alloc(10 * 1024 * 1024 + 1);
  await assert.rejects(
    () => processImage(big),
    (e: unknown) => e instanceof ImageError && e.status === 413,
  );
});

// ---------------------------------------------------------------------------
// isPrivateIp
// ---------------------------------------------------------------------------

test('isPrivateIp blocks private, loopback, and link-local ranges', () => {
  for (const ip of [
    '10.0.0.1', '10.255.255.255',
    '127.0.0.1', '127.0.0.2',
    '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '192.168.255.255',
    '169.254.0.1',
    '0.0.0.0',
    '100.64.0.1', '100.127.255.255',
    '::1', '::',
    'fc00::1', 'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
});

test('isPrivateIp blocks NAT64, IPv4-compatible, multicast, and reserved ranges', () => {
  for (const ip of [
    // NAT64 well-known prefix (embeds IPv4).
    '64:ff9b::7f00:1', // -> 127.0.0.1
    '64:ff9b::a00:1', // -> 10.0.0.1
    // IPv4-compatible IPv6 (::a.b.c.d).
    '::7f00:1', // -> 127.0.0.1
    '::a00:1', // -> 10.0.0.1
    // IPv6 multicast + documentation.
    'ff02::1', 'ff00::1',
    '2001:db8::1',
    // IPv4 TEST-NET, benchmarking, multicast, reserved.
    '192.0.2.1', '198.51.100.1', '203.0.113.1',
    '198.18.0.1', '198.19.255.255',
    '224.0.0.1', '239.255.255.255',
    '240.0.0.1', '255.255.255.255',
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
});

test('isPrivateIp allows public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

// ---------------------------------------------------------------------------
// fetchImageUrl (SSRF guard)
// ---------------------------------------------------------------------------

test('fetchImageUrl rejects non-http(s) schemes', async () => {
  await assert.rejects(
    () => fetchImageUrl('file:///etc/passwd'),
    (e: unknown) => e instanceof ImageError && e.status === 400,
  );
  await assert.rejects(
    () => fetchImageUrl('ftp://example.com/x.png'),
    (e: unknown) => e instanceof ImageError && e.status === 400,
  );
});

test('fetchImageUrl rejects private/loopback hosts', async () => {
  for (const url of [
    'http://127.0.0.1/x.png',
    'http://localhost/x.png',
    'http://10.0.0.5/x.png',
    'http://192.168.1.1/x.png',
    'http://[::1]/x.png',
  ]) {
    await assert.rejects(
      () => fetchImageUrl(url),
      (e: unknown) => e instanceof ImageError && e.status === 400,
      `${url} should be SSRF-blocked`,
    );
  }
});

test('fetchImageUrl rejects an invalid URL', async () => {
  await assert.rejects(
    () => fetchImageUrl('not a url'),
    (e: unknown) => e instanceof ImageError && e.status === 400,
  );
});