import { readdirSync } from 'node:fs';
import path from 'node:path';

import { listHeroImages } from '@/lib/db';

/**
 * Hero background rotation.
 *
 * The hero image is picked at request time from two sources, in order:
 *
 * 1. **DB-stored images** (managed via the token-gated API/MCP — see
 *    `POST /api/hero-images`): stored in SQLite so they survive container
 *    rebuilds on the `/data` volume. Served at `/hero-images/{id}`.
 * 2. **`public/hero-bg-*` files** (operator-dropped): any file in `public/`
 *    whose name starts with `hero-bg` (e.g. `hero-bg-2.jpg`) is a candidate —
 *    no code change needed to add one.
 *
 * Falls back to the configured theme image when neither source has
 * candidates (or the DB/`public/` can't be read). All hero pages are
 * `force-dynamic`, so every page load re-renders and picks a fresh random
 * image.
 */

const HERO_PREFIX = 'hero-bg';
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|avif|gif)$/i;

export function getRandomHeroImageUrl(fallback: string): string {
  // 1. DB-stored images are the primary source (API/MCP-managed).
  try {
    const stored = listHeroImages();
    if (stored.length > 0) {
      const pick = stored[Math.floor(Math.random() * stored.length)];
      return `/hero-images/${pick.id}`;
    }
  } catch {
    // DB unavailable — fall through to public/ files.
  }

  // 2. public/hero-bg-* files remain candidates (backward compatible).
  try {
    const publicDir = path.join(process.cwd(), 'public');
    const candidates = readdirSync(publicDir)
      .filter((file) => file.toLowerCase().startsWith(HERO_PREFIX) && IMAGE_EXTENSION.test(file))
      .sort();
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return `/${pick}`;
    }
  } catch {
    // public/ unreadable (e.g. read-only filesystem) — fall through to the fallback.
  }
  return fallback;
}