/**
 * Compact hero banner for subpages: the page title overlaid on the page's
 * hero background. The background itself is rendered once at the page level
 * by HeroVisual; this component only lays out the title text.
 */
export function PageHero({
  kicker,
  title,
  subtitle,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <section className="px-6 pb-12 pt-32 sm:px-10 sm:pt-40">
      <div className="relative mx-auto max-w-3xl">
        {kicker && (
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-signal">{kicker}</p>
        )}
        <h1 className="mt-4 font-display text-3xl font-medium text-balance sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-4 max-w-2xl text-lg text-muted">{subtitle}</p>}
      </div>
    </section>
  );
}