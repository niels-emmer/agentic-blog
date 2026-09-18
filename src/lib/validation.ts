import type { Article, ArticleStatus } from '@/content/articles';
import type { SiteConfigPatch } from '@/lib/db';
import { slugifyTag, slugifyTitle } from '@/lib/slugify';
import { FONT_ALLOW_LIST, isHexColor, isSafeHeroUrl, type Theme } from '@/lib/theme';

const STATUSES: ArticleStatus[] = ['draft', 'published', 'archived'];

// Content size limits — keep the DB, rendered pages, and list responses bounded.
const LIMITS = {
  title: 200,
  dek: 500,
  logged: 100,
  eventDate: 200,
  agentNotes: 10_000,
  tag: 50,
  maxTags: 20,
  heading: 200,
  paragraph: 20_000,
  maxParagraphsPerSection: 50,
  maxSections: 50,
  sourceLabel: 200,
  sourceUrl: 2_000,
  maxSources: 50,
} as const;

export type ValidationResult =
  | { ok: true; value: Article }
  | { ok: false; errors: string[] };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Only http/https URLs are allowed (blocks data:, javascript:, etc.). */
function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates an untrusted JSON body against the `Article` shape.
 *
 * `requireSlug: false` (create) derives a slug from the title when none is
 * given. `requireSlug: true` (update) requires the slug to match the URL.
 */
export function validateArticle(input: unknown, opts: { requireSlug: boolean }): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['body must be a JSON object'] };
  }
  const o = input as Record<string, unknown>;

  // slug
  let slug = typeof o.slug === 'string' ? o.slug.trim() : '';
  if (!slug && !opts.requireSlug) {
    slug = typeof o.title === 'string' ? slugifyTitle(o.title) : '';
  }
  if (!slug) {
    errors.push('slug is required (or a title to derive it from)');
  } else if (!/^[a-z0-9-]+$/.test(slug)) {
    errors.push('slug must be lowercase alphanumeric with hyphens only');
  } else if (slug.length > 100) {
    errors.push('slug must be at most 100 characters');
  }

  // title / dek / logged
  if (!isNonEmptyString(o.title)) errors.push('title is required');
  else if (o.title.trim().length > LIMITS.title) errors.push(`title must be at most ${LIMITS.title} characters`);
  if (!isNonEmptyString(o.dek)) errors.push('dek is required');
  else if (o.dek.trim().length > LIMITS.dek) errors.push(`dek must be at most ${LIMITS.dek} characters`);
  if (!isNonEmptyString(o.logged)) errors.push('logged is required');
  else if (o.logged.trim().length > LIMITS.logged) errors.push(`logged must be at most ${LIMITS.logged} characters`);

  // eventDate (optional)
  if (o.eventDate !== undefined) {
    if (typeof o.eventDate !== 'string') errors.push('eventDate must be a string');
    else if (o.eventDate.length > LIMITS.eventDate) errors.push(`eventDate must be at most ${LIMITS.eventDate} characters`);
  }

  // status
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status as ArticleStatus)) {
    errors.push(`status must be one of: ${STATUSES.join(', ')}`);
  }

  // tags
  if (!Array.isArray(o.tags) || o.tags.length === 0) {
    errors.push('tags must be a non-empty array of strings');
  } else if (o.tags.length > LIMITS.maxTags) {
    errors.push(`tags must have at most ${LIMITS.maxTags} entries`);
  } else {
    for (const tag of o.tags) {
      if (!isNonEmptyString(tag)) {
        errors.push('each tag must be a non-empty string');
        break;
      }
      if (tag.trim().length > LIMITS.tag) {
        errors.push(`each tag must be at most ${LIMITS.tag} characters`);
        break;
      }
      if (!slugifyTag(tag)) {
        errors.push(`tag "${tag}" does not produce a valid slug`);
        break;
      }
    }
  }

  // sections
  if (!Array.isArray(o.sections) || o.sections.length === 0) {
    errors.push('sections must be a non-empty array');
  } else if (o.sections.length > LIMITS.maxSections) {
    errors.push(`sections must have at most ${LIMITS.maxSections} entries`);
  } else {
    for (const section of o.sections) {
      if (typeof section !== 'object' || section === null) {
        errors.push('each section must be an object with heading and paragraphs');
        break;
      }
      const s = section as Record<string, unknown>;
      if (!isNonEmptyString(s.heading)) {
        errors.push('each section needs a non-empty heading');
        break;
      }
      if (s.heading.trim().length > LIMITS.heading) {
        errors.push(`each heading must be at most ${LIMITS.heading} characters`);
        break;
      }
      if (!Array.isArray(s.paragraphs) || s.paragraphs.length === 0) {
        errors.push('each section needs a non-empty paragraphs array of strings');
        break;
      }
      if (s.paragraphs.length > LIMITS.maxParagraphsPerSection) {
        errors.push(`each section must have at most ${LIMITS.maxParagraphsPerSection} paragraphs`);
        break;
      }
      for (const paragraph of s.paragraphs) {
        if (typeof paragraph !== 'string') {
          errors.push('each paragraph must be a string');
          break;
        }
        if (paragraph.length > LIMITS.paragraph) {
          errors.push(`each paragraph must be at most ${LIMITS.paragraph} characters`);
          break;
        }
      }
    }
  }

  // sources (optional)
  if (o.sources !== undefined) {
    if (!Array.isArray(o.sources)) {
      errors.push('sources must be an array');
    } else if (o.sources.length > LIMITS.maxSources) {
      errors.push(`sources must have at most ${LIMITS.maxSources} entries`);
    } else {
      for (const source of o.sources) {
        if (typeof source !== 'object' || source === null) {
          errors.push('each source needs label and url strings');
          break;
        }
        const s = source as Record<string, unknown>;
        if (!isNonEmptyString(s.label) || s.label.trim().length > LIMITS.sourceLabel) {
          errors.push(`each source label must be a non-empty string of at most ${LIMITS.sourceLabel} characters`);
          break;
        }
        if (!isNonEmptyString(s.url) || s.url.length > LIMITS.sourceUrl) {
          errors.push(`each source url must be a non-empty string of at most ${LIMITS.sourceUrl} characters`);
          break;
        }
        if (!isSafeUrl(s.url)) {
          errors.push(`source url "${s.url}" must be an http(s) URL`);
          break;
        }
      }
    }
  }

  // agentNotes (optional)
  if (o.agentNotes !== undefined) {
    if (typeof o.agentNotes !== 'string') errors.push('agentNotes must be a string');
    else if (o.agentNotes.length > LIMITS.agentNotes) errors.push(`agentNotes must be at most ${LIMITS.agentNotes} characters`);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      slug,
      title: (o.title as string).trim(),
      dek: (o.dek as string).trim(),
      logged: (o.logged as string).trim(),
      eventDate: o.eventDate as string | undefined,
      status: o.status as ArticleStatus,
      tags: (o.tags as string[]).map((t) => t.trim()),
      sections: (o.sections as { heading: string; paragraphs: string[] }[]).map((s) => ({
        heading: s.heading.trim(),
        paragraphs: s.paragraphs,
      })),
      sources: o.sources
        ? (o.sources as { label: string; url: string }[]).map((s) => ({
            label: s.label.trim(),
            url: s.url.trim(),
          }))
        : undefined,
      agentNotes: o.agentNotes as string | undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Site config validation
// ---------------------------------------------------------------------------

// Site-config size limits — mirror the content limits' spirit (bounded
// strings, http/https URLs only) so config strings cannot bloat the DB or
// inject markup.
const CONFIG_LIMITS = {
  siteTitle: 200,
  siteDescription: 500,
  siteUrl: 2_000,
  heroKicker: 200,
  heroTitle: 200,
  heroParagraph: 2_000,
  maxHeroParagraphs: 10,
  footerText: 2_000,
  footerDisclaimer: 2_000,
  homepageCapMax: 100,
} as const;

const CONFIG_KEYS = [
  'siteTitle',
  'siteDescription',
  'siteUrl',
  'heroKicker',
  'heroTitle',
  'heroParagraphs',
  'footerText',
  'footerDisclaimer',
  'robotsIndex',
  'homepageCap',
  'feedEnabled',
  'theme',
] as const;

const COLOR_KEYS = ['ink', 'paper', 'signal', 'signalDim', 'line', 'muted'] as const;
const FONT_KEYS = ['display', 'body', 'mono'] as const;

export type SiteConfigValidationResult =
  | { ok: true; value: SiteConfigPatch }
  | { ok: false; errors: string[] };

/**
 * Validates a site-config update. PATCH semantics: only the keys present in
 * the input are validated and returned; unknown keys are rejected.
 */
export function validateSiteConfig(input: unknown): SiteConfigValidationResult {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['body must be a JSON object'] };
  }
  const o = input as Record<string, unknown>;

  for (const key of Object.keys(o)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
      errors.push(`unknown field "${key}"`);
    }
  }

  const value: SiteConfigPatch = {};

  if (o.siteTitle !== undefined) {
    if (!isNonEmptyString(o.siteTitle)) errors.push('siteTitle must be a non-empty string');
    else if (o.siteTitle.trim().length > CONFIG_LIMITS.siteTitle)
      errors.push(`siteTitle must be at most ${CONFIG_LIMITS.siteTitle} characters`);
    else value.siteTitle = o.siteTitle.trim();
  }

  if (o.siteDescription !== undefined) {
    if (!isNonEmptyString(o.siteDescription)) errors.push('siteDescription must be a non-empty string');
    else if (o.siteDescription.trim().length > CONFIG_LIMITS.siteDescription)
      errors.push(`siteDescription must be at most ${CONFIG_LIMITS.siteDescription} characters`);
    else value.siteDescription = o.siteDescription.trim();
  }

  if (o.siteUrl !== undefined) {
    if (!isNonEmptyString(o.siteUrl)) errors.push('siteUrl must be a non-empty string');
    else if (o.siteUrl.length > CONFIG_LIMITS.siteUrl)
      errors.push(`siteUrl must be at most ${CONFIG_LIMITS.siteUrl} characters`);
    else if (!isSafeUrl(o.siteUrl)) errors.push('siteUrl must be an http(s) URL');
    else value.siteUrl = o.siteUrl.trim();
  }

  if (o.heroKicker !== undefined) {
    if (!isNonEmptyString(o.heroKicker)) errors.push('heroKicker must be a non-empty string');
    else if (o.heroKicker.trim().length > CONFIG_LIMITS.heroKicker)
      errors.push(`heroKicker must be at most ${CONFIG_LIMITS.heroKicker} characters`);
    else value.heroKicker = o.heroKicker.trim();
  }

  if (o.heroTitle !== undefined) {
    if (!isNonEmptyString(o.heroTitle)) errors.push('heroTitle must be a non-empty string');
    else if (o.heroTitle.trim().length > CONFIG_LIMITS.heroTitle)
      errors.push(`heroTitle must be at most ${CONFIG_LIMITS.heroTitle} characters`);
    else value.heroTitle = o.heroTitle.trim();
  }

  if (o.heroParagraphs !== undefined) {
    if (!Array.isArray(o.heroParagraphs) || o.heroParagraphs.length === 0) {
      errors.push('heroParagraphs must be a non-empty array of strings');
    } else if (o.heroParagraphs.length > CONFIG_LIMITS.maxHeroParagraphs) {
      errors.push(`heroParagraphs must have at most ${CONFIG_LIMITS.maxHeroParagraphs} entries`);
    } else {
      const paragraphs: string[] = [];
      for (const paragraph of o.heroParagraphs) {
        if (!isNonEmptyString(paragraph)) {
          errors.push('each hero paragraph must be a non-empty string');
          break;
        }
        if (paragraph.trim().length > CONFIG_LIMITS.heroParagraph) {
          errors.push(`each hero paragraph must be at most ${CONFIG_LIMITS.heroParagraph} characters`);
          break;
        }
        paragraphs.push(paragraph.trim());
      }
      if (paragraphs.length === o.heroParagraphs.length) value.heroParagraphs = paragraphs;
    }
  }

  if (o.footerText !== undefined) {
    if (!isNonEmptyString(o.footerText)) errors.push('footerText must be a non-empty string');
    else if (o.footerText.trim().length > CONFIG_LIMITS.footerText)
      errors.push(`footerText must be at most ${CONFIG_LIMITS.footerText} characters`);
    else value.footerText = o.footerText.trim();
  }

  if (o.footerDisclaimer !== undefined) {
    if (!isNonEmptyString(o.footerDisclaimer)) errors.push('footerDisclaimer must be a non-empty string');
    else if (o.footerDisclaimer.trim().length > CONFIG_LIMITS.footerDisclaimer)
      errors.push(`footerDisclaimer must be at most ${CONFIG_LIMITS.footerDisclaimer} characters`);
    else value.footerDisclaimer = o.footerDisclaimer.trim();
  }

  if (o.robotsIndex !== undefined) {
    if (typeof o.robotsIndex !== 'boolean') errors.push('robotsIndex must be a boolean');
    else value.robotsIndex = o.robotsIndex;
  }

  if (o.feedEnabled !== undefined) {
    if (typeof o.feedEnabled !== 'boolean') errors.push('feedEnabled must be a boolean');
    else value.feedEnabled = o.feedEnabled;
  }

  if (o.homepageCap !== undefined) {
    if (typeof o.homepageCap !== 'number' || !Number.isInteger(o.homepageCap)) {
      errors.push('homepageCap must be an integer');
    } else if (o.homepageCap < 1 || o.homepageCap > CONFIG_LIMITS.homepageCapMax) {
      errors.push(`homepageCap must be between 1 and ${CONFIG_LIMITS.homepageCapMax}`);
    } else {
      value.homepageCap = o.homepageCap;
    }
  }

  if (o.theme !== undefined) {
    const themeResult = validateThemePatch(o.theme);
    if (!themeResult.ok) {
      errors.push(...themeResult.errors);
    } else {
      value.theme = themeResult.value;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Theme validation (partial patch — only provided sub-fields change)
// ---------------------------------------------------------------------------

export type ThemePatch = {
  colors?: Partial<Theme['colors']>;
  fonts?: Partial<Theme['fonts']>;
  heroImageUrl?: string;
};

export type ThemeValidationResult =
  | { ok: true; value: ThemePatch }
  | { ok: false; errors: string[] };

export function validateThemePatch(input: unknown): ThemeValidationResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['theme must be an object'] };
  }
  const o = input as Record<string, unknown>;

  for (const key of Object.keys(o)) {
    if (key !== 'colors' && key !== 'fonts' && key !== 'heroImageUrl') {
      errors.push(`unknown theme field "${key}"`);
    }
  }

  const value: ThemePatch = {};

  if (o.colors !== undefined) {
    if (typeof o.colors !== 'object' || o.colors === null || Array.isArray(o.colors)) {
      errors.push('theme.colors must be an object');
    } else {
      const colors = o.colors as Record<string, unknown>;
      for (const key of Object.keys(colors)) {
        if (!(COLOR_KEYS as readonly string[]).includes(key)) {
          errors.push(`unknown theme color "${key}"`);
        }
      }
      const colorPatch: ThemePatch['colors'] = {};
      for (const key of COLOR_KEYS) {
        const raw = colors[key];
        if (raw === undefined) continue;
        if (typeof raw !== 'string' || !isHexColor(raw)) {
          errors.push(`theme color "${key}" must be a hex color like #0a0c0f`);
        } else {
          colorPatch[key] = raw.toLowerCase();
        }
      }
      if (Object.keys(colorPatch).length > 0) value.colors = colorPatch;
    }
  }

  if (o.fonts !== undefined) {
    if (typeof o.fonts !== 'object' || o.fonts === null || Array.isArray(o.fonts)) {
      errors.push('theme.fonts must be an object');
    } else {
      const fonts = o.fonts as Record<string, unknown>;
      for (const key of Object.keys(fonts)) {
        if (!(FONT_KEYS as readonly string[]).includes(key)) {
          errors.push(`unknown theme font role "${key}"`);
        }
      }
      const fontPatch: ThemePatch['fonts'] = {};
      for (const key of FONT_KEYS) {
        const raw = fonts[key];
        if (raw === undefined) continue;
        if (typeof raw !== 'string' || !FONT_ALLOW_LIST.includes(raw)) {
          errors.push(`theme font "${key}" must be one of: ${FONT_ALLOW_LIST.join(', ')}`);
        } else {
          fontPatch[key] = raw;
        }
      }
      if (Object.keys(fontPatch).length > 0) value.fonts = fontPatch;
    }
  }

  if (o.heroImageUrl !== undefined) {
    if (typeof o.heroImageUrl !== 'string' || !isSafeHeroUrl(o.heroImageUrl)) {
      errors.push('theme.heroImageUrl must be an http(s) URL or a root-relative path');
    } else {
      value.heroImageUrl = o.heroImageUrl;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}