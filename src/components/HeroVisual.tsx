import Image from 'next/image';

import { getSiteConfig } from '@/lib/db';
import { getRandomHeroImageUrl } from '@/lib/hero-image';

/**
 * Page-level hero background. Attached to the top of the page and extending
 * down past the fold, fading to the page's ink background so there is no
 * visible line where the image ends and the black page background begins.
 *
 * Rendered once per page (server component) as the first child of the page
 * container, which must be `relative isolate` so the -z-10 background sits
 * behind the content but above the page's ink background.
 *
 * When no `heroImageUrl` is passed, a random `public/hero-bg-*` image is
 * picked per page load (see `getRandomHeroImageUrl`); the configured theme
 * image is the fallback. An empty resolved URL renders only the gradient
 * overlays (no image).
 *
 * Local root-relative images use next/image (optimized, matching the
 * baseline). Remote http(s) URLs fall back to a plain <img> — next/image
 * requires build-time remotePatterns config, which is impossible for a
 * runtime-configurable URL.
 */
export function HeroVisual({ heroImageUrl }: { heroImageUrl?: string }) {
  const url = heroImageUrl ?? getRandomHeroImageUrl(getSiteConfig().theme.heroImageUrl);
  const isRemote = /^https?:\/\//.test(url);
  return (
    <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[120vh] overflow-hidden">
      {url !== '' &&
        (isRemote ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        ) : (
          <Image
            src={url}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-top"
          />
        ))}
      {/* Required, not decorative: the overlays alone leave enough contrast for the hero text. */}
      <div className="absolute inset-0 bg-ink/60" />
      <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/80 to-ink" />
    </div>
  );
}