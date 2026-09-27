import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getRandomHeroImageUrl } from '@/lib/hero-image';

const publicDir = path.join(process.cwd(), 'public');
const FIXTURE = 'hero-bg-test.jpg';

test('getRandomHeroImageUrl picks a hero-bg candidate from public/ when one exists', () => {
  // The filter only matches the filename prefix + extension, so an empty
  // fixture file is a valid candidate for URL selection.
  writeFileSync(path.join(publicDir, FIXTURE), '');
  try {
    for (let i = 0; i < 20; i++) {
      const url = getRandomHeroImageUrl('/fallback.jpg');
      assert.ok(url.startsWith('/hero-bg'), `expected a hero-bg URL, got ${url}`);
      assert.equal(url, `/${FIXTURE}`, `expected the fixture, got ${url}`);
    }
  } finally {
    unlinkSync(path.join(publicDir, FIXTURE));
  }
});

test('getRandomHeroImageUrl falls back when public/ has no candidates', (t) => {
  const candidates = readdirSync(publicDir).filter((f) =>
    f.toLowerCase().startsWith('hero-bg'),
  );
  if (candidates.length > 0) {
    t.skip('public/ already contains hero-bg candidates');
    return;
  }
  assert.equal(getRandomHeroImageUrl('/fallback.jpg'), '/fallback.jpg');
});