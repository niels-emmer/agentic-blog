import { getSiteConfig } from '@/lib/db';
import { DEFAULT_FONTS, FONT_MAP } from '@/lib/theme';

/**
 * Applies the configured theme at runtime by overriding Tailwind v4's CSS
 * variables on `:root` (components use token classes like `bg-ink`,
 * `text-paper`, `text-signal`, so no component changes are needed).
 *
 * Fonts are the one build-time wrinkle: the default three fonts are loaded
 * by `next/font` at build time (identical rendering to the baseline), so
 * when a role still uses its default font we leave the variable untouched.
 * Any other allow-listed font is loaded at runtime via a Google Fonts
 * `<link>` and the variable is overridden with its stack.
 */
export function ThemeProvider() {
  const theme = getSiteConfig().theme;

  const cssVars: Record<string, string> = {
    '--color-ink': theme.colors.ink,
    '--color-paper': theme.colors.paper,
    '--color-signal': theme.colors.signal,
    '--color-signal-dim': theme.colors.signalDim,
    '--color-line': theme.colors.line,
    '--color-muted': theme.colors.muted,
  };

  const fontRoles = [
    { role: 'display', font: theme.fonts.display, cssVar: '--font-display' },
    { role: 'body', font: theme.fonts.body, cssVar: '--font-body' },
    { role: 'mono', font: theme.fonts.mono, cssVar: '--font-mono' },
  ] as const;

  const links: React.ReactElement[] = [];
  for (const { role, font, cssVar } of fontRoles) {
    if (font === DEFAULT_FONTS[role]) continue; // next/font already loads it
    if (!Object.hasOwn(FONT_MAP, font)) continue; // unreachable — validation enforces the allow-list
    const entry = FONT_MAP[font];
    cssVars[cssVar] = entry.stack;
    if (entry.googleUrl) {
      links.push(<link key={role} rel="stylesheet" href={entry.googleUrl} />);
    }
  }

  const styleContent = `:root{${Object.entries(cssVars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')}}`;

  return (
    <>
      {links}
      <style>{styleContent}</style>
    </>
  );
}