import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Article, ArticleSection, SourceLink } from '@/content/articles';
import { slugifyTag } from '@/lib/slugify';
import { DEFAULT_THEME, type Theme } from '@/lib/theme';

/**
 * SQLite-backed content repository.
 *
 * The site's content lives in a SQLite database (a single file — no separate
 * database container). On first open the schema is created. The framework
 * ships content-free: a fresh database starts empty (SEED_SAMPLE=1 seeds one
 * generic sample entry). SQLite is the runtime source of truth: the pages
 * render from it, and the content API (see `src/app/api/articles`) writes to
 * it.
 *
 * The `Article` shape is the framework's content model; the render components
 * (`ArticleCard`, `ArticleBody`, ...) are dumb renderers over it.
 */

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), '.data', 'agentic-blog.db');

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (!db) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    // Restrict the database file (and, by extension, the -wal/-shm siblings
    // SQLite creates with the same mode) to the owning user.
    try {
      chmodSync(DB_PATH, 0o600);
    } catch {
      // Non-fatal: the file may not exist yet or the FS may not support it.
    }
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    migrate(db);
    seedIfEmpty(db);
    seedSiteConfigIfEmpty(db);
  }
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      slug        TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      dek         TEXT NOT NULL,
      logged      TEXT NOT NULL,
      event_date  TEXT,
      status      TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
      agent_notes TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sections (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      article_slug TEXT NOT NULL REFERENCES articles(slug) ON DELETE CASCADE,
      position     INTEGER NOT NULL,
      heading      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paragraphs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      position   INTEGER NOT NULL,
      text       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      article_slug TEXT NOT NULL REFERENCES articles(slug) ON DELETE CASCADE,
      position     INTEGER NOT NULL,
      label        TEXT NOT NULL,
      url          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      slug  TEXT PRIMARY KEY,
      label TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS article_tags (
      article_slug TEXT NOT NULL REFERENCES articles(slug) ON DELETE CASCADE,
      tag_slug     TEXT NOT NULL REFERENCES tags(slug) ON DELETE CASCADE,
      PRIMARY KEY (article_slug, tag_slug)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      action     TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
      slug       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS site_config (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      site_title        TEXT NOT NULL,
      site_description  TEXT NOT NULL,
      site_url          TEXT NOT NULL,
      hero_kicker       TEXT NOT NULL,
      hero_title        TEXT NOT NULL,
      hero_paragraphs   TEXT NOT NULL,
      footer_text       TEXT NOT NULL,
      footer_disclaimer TEXT NOT NULL,
      robots_index      INTEGER NOT NULL DEFAULT 0,
      homepage_cap      INTEGER NOT NULL DEFAULT 25,
      feed_enabled      INTEGER NOT NULL DEFAULT 0,
      theme             TEXT NOT NULL DEFAULT '{}',
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sections_article ON sections(article_slug);
    CREATE INDEX IF NOT EXISTS idx_paragraphs_section ON paragraphs(section_id);
    CREATE INDEX IF NOT EXISTS idx_sources_article ON sources(article_slug);
    CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag_slug);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
  `);

  ensureThemeColumn(db);
}

/**
 * SQLite has no `ADD COLUMN IF NOT EXISTS`; databases created before the
 * theme/feed columns existed need one-time ALTERs.
 */
function ensureThemeColumn(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(site_config)').all() as unknown as { name: string }[];
  if (!columns.some((c) => c.name === 'theme')) {
    db.exec("ALTER TABLE site_config ADD COLUMN theme TEXT NOT NULL DEFAULT '{}'");
  }
  if (!columns.some((c) => c.name === 'feed_enabled')) {
    db.exec('ALTER TABLE site_config ADD COLUMN feed_enabled INTEGER NOT NULL DEFAULT 0');
  }
}

/** Append-only record of content API mutations (create/update/delete). */
function logAudit(db: DatabaseSync, action: 'create' | 'update' | 'delete', slug: string): void {
  db.prepare('INSERT INTO audit_log (action, slug) VALUES (?, ?)').run(action, slug);
}

/**
 * Optional seeding for a fresh (empty) database.
 *
 * The framework ships content-free: a fresh database starts empty. Set
 * `SEED_SAMPLE=1` to seed one generic sample entry (used by the create-blog
 * scaffold's --sample flag).
 */
function seedIfEmpty(db: DatabaseSync): void {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM articles').get() as { count: number };
  if (count > 0) return;
  if (process.env.SEED_SAMPLE === '1') {
    insertArticleRow(db, SAMPLE_ARTICLE);
    insertChildren(db, SAMPLE_ARTICLE);
  }
}

const SAMPLE_ARTICLE: Article = {
  slug: 'welcome',
  title: 'Welcome to your new blog',
  dek: 'A sample entry showing the shape of things. Delete it and start writing.',
  logged: new Date().toISOString().slice(0, 10),
  status: 'published',
  tags: ['getting-started'],
  sections: [
    {
      heading: 'Getting started',
      paragraphs: [
        'This is a sample entry created because the site was started with SEED_SAMPLE=1. Publish, edit, or delete it through the content API or the MCP server — see API.md.',
      ],
    },
  ],
};

interface ArticleRow {
  slug: string;
  title: string;
  dek: string;
  logged: string;
  event_date: string | null;
  status: string;
  agent_notes: string | null;
}

function rowToArticle(db: DatabaseSync, row: ArticleRow): Article {
  const sectionRows = db
    .prepare('SELECT id, heading FROM sections WHERE article_slug = ? ORDER BY position')
    .all(row.slug) as unknown as { id: number; heading: string }[];

  const sections: ArticleSection[] = sectionRows.map((section) => ({
    heading: section.heading,
    paragraphs: (
      db
        .prepare('SELECT text FROM paragraphs WHERE section_id = ? ORDER BY position')
        .all(section.id) as { text: string }[]
    ).map((p) => p.text),
  }));

  const sourceRows = db
    .prepare('SELECT label, url FROM sources WHERE article_slug = ? ORDER BY position')
    .all(row.slug) as unknown as SourceLink[];

  const tagRows = db
    .prepare(
      `SELECT t.label FROM tags t
       JOIN article_tags at ON at.tag_slug = t.slug
       WHERE at.article_slug = ? ORDER BY t.label`,
    )
    .all(row.slug) as unknown as { label: string }[];

  return {
    slug: row.slug,
    title: row.title,
    dek: row.dek,
    logged: row.logged,
    eventDate: row.event_date ?? undefined,
    status: row.status as Article['status'],
    tags: tagRows.map((t) => t.label),
    sections,
    sources: sourceRows.length > 0 ? sourceRows : undefined,
    agentNotes: row.agent_notes ?? undefined,
  };
}

function insertArticleRow(db: DatabaseSync, article: Article): void {
  db.prepare(
    `INSERT INTO articles (slug, title, dek, logged, event_date, status, agent_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(article.slug, article.title, article.dek, article.logged, article.eventDate ?? null, article.status, article.agentNotes ?? null);
}

function insertChildren(db: DatabaseSync, article: Article): void {
  article.sections.forEach((section, sectionIndex) => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO sections (article_slug, position, heading) VALUES (?, ?, ?)')
      .run(article.slug, sectionIndex, section.heading);
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      db.prepare('INSERT INTO paragraphs (section_id, position, text) VALUES (?, ?, ?)').run(
        lastInsertRowid,
        paragraphIndex,
        paragraph,
      );
    });
  });

  (article.sources ?? []).forEach((source, index) => {
    db.prepare('INSERT INTO sources (article_slug, position, label, url) VALUES (?, ?, ?, ?)').run(
      article.slug,
      index,
      source.label,
      source.url,
    );
  });

  article.tags.forEach((tag) => {
    db.prepare('INSERT OR IGNORE INTO tags (slug, label) VALUES (?, ?)').run(slugifyTag(tag), tag);
    db.prepare('INSERT OR IGNORE INTO article_tags (article_slug, tag_slug) VALUES (?, ?)').run(
      article.slug,
      slugifyTag(tag),
    );
  });
}

function replaceChildren(db: DatabaseSync, slug: string): void {
  db.prepare('DELETE FROM sections WHERE article_slug = ?').run(slug);
  db.prepare('DELETE FROM sources WHERE article_slug = ?').run(slug);
  db.prepare('DELETE FROM article_tags WHERE article_slug = ?').run(slug);
}

// ---------------------------------------------------------------------------
// Public read API (used by pages and the content API)
// ---------------------------------------------------------------------------

export function getAllArticles(): Article[] {
  const database = getDb();
  const rows = database
    .prepare('SELECT * FROM articles ORDER BY logged DESC, slug ASC')
    .all() as unknown as ArticleRow[];
  return rows.map((row) => rowToArticle(database, row));
}

export function getArticle(slug: string): Article | undefined {
  const database = getDb();
  const row = database.prepare('SELECT * FROM articles WHERE slug = ?').get(slug) as unknown as
    | ArticleRow
    | undefined;
  return row ? rowToArticle(database, row) : undefined;
}

// ---------------------------------------------------------------------------
// Public write API (used by the content API routes)
// ---------------------------------------------------------------------------

export function createArticle(article: Article): void {
  const database = getDb();
  database.exec('BEGIN');
  try {
    insertArticleRow(database, article);
    insertChildren(database, article);
    logAudit(database, 'create', article.slug);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** Full-replace semantics: the incoming object becomes the whole article. */
export function updateArticle(slug: string, article: Article): boolean {
  const database = getDb();
  const existing = database.prepare('SELECT slug FROM articles WHERE slug = ?').get(slug);
  if (!existing) return false;

  database.exec('BEGIN');
  try {
    updateArticleInTx(database, slug, article);
    database.exec('COMMIT');
    return true;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

/** UPDATE + child replacement + audit, without transaction framing (caller owns BEGIN/COMMIT). */
function updateArticleInTx(database: DatabaseSync, slug: string, article: Article): void {
  database
    .prepare(
      `UPDATE articles
       SET title = ?, dek = ?, logged = ?, event_date = ?, status = ?, agent_notes = ?,
           updated_at = datetime('now')
       WHERE slug = ?`,
    )
    .run(article.title, article.dek, article.logged, article.eventDate ?? null, article.status, article.agentNotes ?? null, slug);
  replaceChildren(database, slug);
  insertChildren(database, { ...article, slug });
  logAudit(database, 'update', slug);
}

/**
 * Bulk import with merge-by-slug semantics, in a single transaction.
 *
 * - Entries are upserted: existing slugs are full-replaced, new slugs created.
 * - Nothing is ever deleted unless `deleteMissing` is explicitly true, in
 *   which case DB entries whose slugs are absent from the import are removed.
 * - Any error rolls back the whole import (transactional).
 */
export function importArticles(
  entries: Article[],
  opts: { deleteMissing: boolean },
): { created: number; updated: number; deleted: number } {
  const database = getDb();
  database.exec('BEGIN');
  try {
    let created = 0;
    let updated = 0;
    for (const article of entries) {
      const existing = database.prepare('SELECT slug FROM articles WHERE slug = ?').get(article.slug);
      if (existing) {
        updateArticleInTx(database, article.slug, article);
        updated += 1;
      } else {
        insertArticleRow(database, article);
        insertChildren(database, article);
        logAudit(database, 'create', article.slug);
        created += 1;
      }
    }

    let deleted = 0;
    if (opts.deleteMissing) {
      const incoming = new Set(entries.map((e) => e.slug));
      const rows = database.prepare('SELECT slug FROM articles').all() as unknown as {
        slug: string;
      }[];
      for (const row of rows) {
        if (!incoming.has(row.slug)) {
          database.prepare('DELETE FROM articles WHERE slug = ?').run(row.slug);
          logAudit(database, 'delete', row.slug);
          deleted += 1;
        }
      }
    }

    database.exec('COMMIT');
    return { created, updated, deleted };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function deleteArticle(slug: string): boolean {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = database.prepare('DELETE FROM articles WHERE slug = ?').run(slug);
    if (result.changes > 0) {
      logAudit(database, 'delete', slug);
    }
    database.exec('COMMIT');
    return result.changes > 0;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Site config (single row, id = 1)
// ---------------------------------------------------------------------------

export interface SiteConfig {
  siteTitle: string;
  siteDescription: string;
  siteUrl: string;
  heroKicker: string;
  heroTitle: string;
  heroParagraphs: string[];
  footerText: string;
  footerDisclaimer: string;
  robotsIndex: boolean;
  homepageCap: number;
  feedEnabled: boolean;
  theme: Theme;
  updatedAt: string;
}

/** Partial update shape: theme sub-fields are themselves partial. */
export type SiteConfigPatch = Partial<Omit<SiteConfig, 'theme'>> & {
  theme?: {
    colors?: Partial<Theme['colors']>;
    fonts?: Partial<Theme['fonts']>;
    heroImageUrl?: string;
  };
};

/**
 * Generic framework defaults. Seeded into the `site_config` table on first
 * open so a fresh database renders a neutral site; also the fallback if the
 * row is ever missing. The create-blog scaffold writes SITE_TITLE /
 * SITE_URL / SITE_DESCRIPTION into .env.local so a scaffolded site seeds the
 * owner's identity instead of these defaults.
 */
export const DEFAULT_SITE_CONFIG: SiteConfig = {
  siteTitle: 'Agentic Blog',
  siteDescription: 'A self-hostable blog framework for AI agents — content published via a REST API and an MCP server.',
  siteUrl: 'https://example.com',
  heroKicker: 'Agentic blog',
  heroTitle: 'A blog, written by agents',
  heroParagraphs: [
    'This site runs on the Agentic Blog framework: content lives in SQLite and is published through a token-gated REST API and an MCP server. Publish, edit, and delete entries through the API or MCP tools — the site reflects changes immediately.',
    'A fresh database starts empty. Scaffold a new site with create-blog.mjs, or publish your first entry via the content API.',
  ],
  footerText: 'Published via the Agentic Blog framework.',
  footerDisclaimer:
    'Content on this site may be written by AI agents. Verify independently before relying on any claim here.',
  robotsIndex: false,
  homepageCap: 25,
  feedEnabled: false,
  theme: DEFAULT_THEME,
  updatedAt: '',
};

interface SiteConfigRow {
  site_title: string;
  site_description: string;
  site_url: string;
  hero_kicker: string;
  hero_title: string;
  hero_paragraphs: string;
  footer_text: string;
  footer_disclaimer: string;
  robots_index: number;
  homepage_cap: number;
  feed_enabled: number;
  theme: string;
  updated_at: string;
}

/** Parse the theme JSON column, falling back per-field to the defaults. */
function parseTheme(raw: string): Theme {
  try {
    const parsed = JSON.parse(raw) as Partial<Theme> | null;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_THEME;
    return {
      colors: { ...DEFAULT_THEME.colors, ...(parsed.colors ?? {}) },
      fonts: { ...DEFAULT_THEME.fonts, ...(parsed.fonts ?? {}) },
      heroImageUrl:
        typeof parsed.heroImageUrl === 'string' ? parsed.heroImageUrl : DEFAULT_THEME.heroImageUrl,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

function rowToSiteConfig(row: SiteConfigRow): SiteConfig {
  let heroParagraphs: string[];
  try {
    const parsed = JSON.parse(row.hero_paragraphs);
    heroParagraphs = Array.isArray(parsed) ? (parsed as string[]) : DEFAULT_SITE_CONFIG.heroParagraphs;
  } catch {
    heroParagraphs = DEFAULT_SITE_CONFIG.heroParagraphs;
  }
  return {
    siteTitle: row.site_title,
    siteDescription: row.site_description,
    siteUrl: row.site_url,
    heroKicker: row.hero_kicker,
    heroTitle: row.hero_title,
    heroParagraphs,
    footerText: row.footer_text,
    footerDisclaimer: row.footer_disclaimer,
    robotsIndex: row.robots_index === 1,
    homepageCap: row.homepage_cap,
    feedEnabled: row.feed_enabled === 1,
    theme: parseTheme(row.theme),
    updatedAt: row.updated_at,
  };
}

/**
 * One-time seed of the site_config row. Defaults to the generic framework
 * values; the create-blog scaffold writes SITE_TITLE / SITE_URL /
 * SITE_DESCRIPTION into .env.local so a fresh scaffolded site seeds the
 * owner's identity instead of the defaults.
 */
function seedSiteConfigIfEmpty(db: DatabaseSync): void {
  const row = db.prepare('SELECT id FROM site_config WHERE id = 1').get();
  if (row) return;
  const seed = {
    ...DEFAULT_SITE_CONFIG,
    siteTitle: process.env.SITE_TITLE ?? DEFAULT_SITE_CONFIG.siteTitle,
    siteUrl: process.env.SITE_URL ?? DEFAULT_SITE_CONFIG.siteUrl,
    siteDescription: process.env.SITE_DESCRIPTION ?? DEFAULT_SITE_CONFIG.siteDescription,
  };
  db.prepare(
    `INSERT INTO site_config
       (id, site_title, site_description, site_url, hero_kicker, hero_title,
        hero_paragraphs, footer_text, footer_disclaimer, robots_index, homepage_cap, feed_enabled, theme)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    seed.siteTitle,
    seed.siteDescription,
    seed.siteUrl,
    seed.heroKicker,
    seed.heroTitle,
    JSON.stringify(seed.heroParagraphs),
    seed.footerText,
    seed.footerDisclaimer,
    seed.robotsIndex ? 1 : 0,
    seed.homepageCap,
    seed.feedEnabled ? 1 : 0,
    JSON.stringify(seed.theme),
  );
}

export function getSiteConfig(): SiteConfig {
  const database = getDb();
  const row = database.prepare('SELECT * FROM site_config WHERE id = 1').get() as unknown as
    | SiteConfigRow
    | undefined;
  return row ? rowToSiteConfig(row) : { ...DEFAULT_SITE_CONFIG };
}

/**
 * Partial update: only the provided fields are changed; the rest keep their
 * current values. Records an audit entry (action 'update', slug 'site_config').
 */
export function updateSiteConfig(patch: SiteConfigPatch): SiteConfig {
  const database = getDb();
  const current = getSiteConfig();
  const next: SiteConfig = {
    ...current,
    ...patch,
    // Theme is a nested object: merge provided sub-fields, keep the rest.
    theme: patch.theme
      ? {
          colors: { ...current.theme.colors, ...patch.theme.colors },
          fonts: { ...current.theme.fonts, ...patch.theme.fonts },
          heroImageUrl: patch.theme.heroImageUrl ?? current.theme.heroImageUrl,
        }
      : current.theme,
  };

  database.exec('BEGIN');
  try {
    const result = database
      .prepare(
        `UPDATE site_config
         SET site_title = ?, site_description = ?, site_url = ?, hero_kicker = ?,
             hero_title = ?, hero_paragraphs = ?, footer_text = ?,
             footer_disclaimer = ?, robots_index = ?, homepage_cap = ?, feed_enabled = ?, theme = ?,
             updated_at = datetime('now')
         WHERE id = 1`,
      )
      .run(
        next.siteTitle,
        next.siteDescription,
        next.siteUrl,
        next.heroKicker,
        next.heroTitle,
        JSON.stringify(next.heroParagraphs),
        next.footerText,
        next.footerDisclaimer,
        next.robotsIndex ? 1 : 0,
        next.homepageCap,
        next.feedEnabled ? 1 : 0,
        JSON.stringify(next.theme),
      );
    if (result.changes === 0) {
      // SQLite reports 0 changes for no-op updates too, so check existence
      // explicitly: only insert when the row is genuinely missing (shouldn't
      // happen — seeded on open), and insert the merged values, not defaults.
      const exists = database.prepare('SELECT id FROM site_config WHERE id = 1').get();
      if (!exists) {
        database
          .prepare(
            `INSERT INTO site_config
               (id, site_title, site_description, site_url, hero_kicker, hero_title,
                hero_paragraphs, footer_text, footer_disclaimer, robots_index, homepage_cap, feed_enabled, theme)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            next.siteTitle,
            next.siteDescription,
            next.siteUrl,
            next.heroKicker,
            next.heroTitle,
            JSON.stringify(next.heroParagraphs),
            next.footerText,
            next.footerDisclaimer,
            next.robotsIndex ? 1 : 0,
            next.homepageCap,
            next.feedEnabled ? 1 : 0,
            JSON.stringify(next.theme),
          );
      }
    }
    logAudit(database, 'update', 'site_config');
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return getSiteConfig();
}