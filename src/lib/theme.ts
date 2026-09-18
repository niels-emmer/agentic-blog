/**
 * Runtime theme model.
 *
 * Tailwind v4 theme tokens are CSS variables (`--color-*`, `--font-*` in
 * `src/app/globals.css`), so a theme can be applied at runtime by overriding
 * those variables on `:root` — no component changes needed.
 *
 * Fonts are the one build-time wrinkle: `next/font` loads the default three
 * at build time; any other allow-listed font is loaded at runtime via a
 * Google Fonts `<link>` (see `ThemeProvider`).
 */

export interface Theme {
  colors: {
    ink: string;
    paper: string;
    signal: string;
    signalDim: string;
    line: string;
    muted: string;
  };
  fonts: {
    display: string;
    body: string;
    mono: string;
  };
  heroImageUrl: string;
}

/**
 * Font allow-list for runtime switching. Only these names are accepted by
 * validation — this is what keeps runtime `<link>` injection safe (no
 * arbitrary URL fetching). Google-hosted fonts get a runtime stylesheet
 * link; system fonts are pure CSS stacks.
 */
export const FONT_MAP: Record<string, { stack: string; googleUrl?: string }> = {
  'Space Grotesk': {
    stack: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
    googleUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&display=swap',
  },
  Inter: {
    stack: "'Inter', ui-sans-serif, system-ui, sans-serif",
    googleUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap',
  },
  'JetBrains Mono': {
    stack: "'JetBrains Mono', ui-monospace, monospace",
    googleUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap',
  },
  Roboto: {
    stack: "'Roboto', ui-sans-serif, system-ui, sans-serif",
    googleUrl: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  },
  'Open Sans': {
    stack: "'Open Sans', ui-sans-serif, system-ui, sans-serif",
    googleUrl: 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600&display=swap',
  },
  'system-ui': { stack: 'system-ui, sans-serif' },
  Georgia: { stack: 'Georgia, serif' },
  'Courier New': { stack: "'Courier New', monospace" },
};

export const FONT_ALLOW_LIST = Object.keys(FONT_MAP);

/** The fonts each role uses by default (loaded via next/font at build time). */
export const DEFAULT_FONTS = {
  display: 'Space Grotesk',
  body: 'Inter',
  mono: 'JetBrains Mono',
} as const;

export const DEFAULT_THEME: Theme = {
  colors: {
    ink: '#0a0c0f',
    paper: '#eef1f0',
    signal: '#5eead4',
    signalDim: '#2dd4bf',
    line: '#1f2a2e',
    muted: '#8b979a',
  },
  fonts: { ...DEFAULT_FONTS },
  // No hero image by default — the framework ships without the original
  // site's artwork. Set one via the theme (PATCH /api/site-config or the
  // update_site_config MCP tool).
  heroImageUrl: '',
};

const HEX_COLOR = /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

/**
 * Hero image URLs: empty string (no hero image), http(s) URLs, or
 * root-relative local paths. Protocol-relative (`//host/path`), single-slash
 * `https:/host` forms, and anything else are rejected. The http(s) branch
 * requires the two-slash form so the check stays consistent with how
 * HeroVisual decides local vs remote.
 */
export function isSafeHeroUrl(value: string): boolean {
  if (value === '') return true;
  if (value.startsWith('//')) return false;
  if (value.startsWith('/')) return true;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }
  return false;
}