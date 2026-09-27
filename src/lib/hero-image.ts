import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Hero background rotation.
 *
 * The hero image is picked at request time from any file in `public/` whose
 * name starts with `hero-bg` (e.g. `hero-bg-2.jpg`), so adding a new picture
 * to `public/` is enough to make it a candidate — no code change. All hero
 * pages are `force-dynamic`, so every page load re-renders and picks a fresh
 * random image. Falls back to the configured theme image when no candidates
 * exist (or `public/` can't be read).
 */

const HERO_PREFIX = 'hero-bg';
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|avif|gif)$/i;

export function getRandomHeroImageUrl(fallback: string): string {
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