import Image from 'next/image';

/**
 * Hero background. Local root-relative images use next/image (optimized);
 * remote http(s) URLs fall back to a plain <img> — next/image requires
 * build-time remotePatterns config, which is impossible for a
 * runtime-configurable URL. An empty heroImageUrl renders only the gradient
 * overlays (no image).
 */
export function HeroVisual({ heroImageUrl = '' }: { heroImageUrl?: string }) {
  const isRemote = /^https?:\/\//.test(heroImageUrl);
  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
      {heroImageUrl !== '' &&
        (isRemote ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        ) : (
          <Image
            src={heroImageUrl}
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