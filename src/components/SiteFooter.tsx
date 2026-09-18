import { getSiteConfig } from '@/lib/db';

export function SiteFooter() {
  const config = getSiteConfig();
  return (
    <footer className="border-t border-white/10 px-6 py-10 text-sm text-muted sm:px-10">
      <p className="mx-auto max-w-3xl">{config.footerText}</p>
      <p className="mx-auto mt-1 max-w-3xl text-xs text-muted/70">{config.footerDisclaimer}</p>
    </footer>
  );
}
