import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getRandomHeroImageUrl } from '@/lib/hero-image';
import { createHeroImage, deleteHeroImage } from '@/lib/db';

const publicDir = path.join(process.cwd(), 'public');
const FIXTURE = 'hero-bg-test.jpg';

// Isolate the DB so the rotation test never touches the repo's own database.
const tempDir = mkdtempSync(path.join(tmpdir(), 'hero-image-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');

test('getRandomHeroImageUrl picks a hero-bg candidate from public/ when the DB is empty', () => {
  // The filter only matches the filename prefix + extension, so an empty
  // fixture file is a valid candidate for URL selection. The assertion is
  // tolerant of other hero-bg files already present in public/.
  writeFileSync(path.join(publicDir, FIXTURE), '');
  try {
    for (let i = 0; i < 20; i++) {
      const url = getRandomHeroImageUrl('/fallback.jpg');
      assert.ok(url.startsWith('/hero-bg'), `expected a hero-bg URL, got ${url}`);
      assert.ok(
        readdirSync(publicDir).includes(url.slice(1)),
        `expected a real file in public/, got ${url}`,
      );
    }
  } finally {
    unlinkSync(path.join(publicDir, FIXTURE));
  }
});

test('getRandomHeroImageUrl prefers DB-stored images over public/ files', () => {
  const stored = createHeroImage({
    name: 'db-image',
    contentType: 'image/webp',
    width: 800,
    height: 450,
    sizeBytes: 100,
    data: new Uint8Array([1, 2, 3]),
  });
  try {
    for (let i = 0; i < 20; i++) {
      const url = getRandomHeroImageUrl('/fallback.jpg');
      assert.equal(url, `/hero-images/${stored.id}`, `expected the DB image, got ${url}`);
    }
  } finally {
    // Clean up so the fallback test below sees an empty DB.
    deleteHeroImage(stored.id);
  }
});

test('getRandomHeroImageUrl falls back when both sources are empty', (t) => {
  const candidates = readdirSync(publicDir).filter((f) =>
    f.toLowerCase().startsWith('hero-bg'),
  );
  if (candidates.length > 0) {
    t.skip('public/ already contains hero-bg candidates');
    return;
  }
  assert.equal(getRandomHeroImageUrl('/fallback.jpg'), '/fallback.jpg');
});

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});