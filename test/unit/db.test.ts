import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Article } from '@/content/articles';

// Point the repository at a throwaway DB before importing it (the module
// caches its connection on first use). SEED_SAMPLE=1 seeds the generic
// sample entry so the CRUD tests have content to work with.
const tempDir = mkdtempSync(path.join(tmpdir(), 'agentic-blog-db-test-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.SEED_SAMPLE = '1';

const db = await import('@/lib/db');

const sample = {
  slug: 'test-entry',
  title: 'Test entry',
  dek: 'A dek',
  logged: '2026-09-10',
  status: 'published',
  tags: ['oversight'],
  sections: [{ heading: 'H', paragraphs: ['P1', 'P2'] }],
  sources: [{ label: 'Src', url: 'https://example.com' }],
  agentNotes: 'notes',
};

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test('fresh database seeds the sample entry when SEED_SAMPLE=1', () => {
  const all = db.getAllArticles();
  assert.equal(all.length, 1, 'expected exactly the sample entry');
  assert.equal(all[0].slug, 'welcome');
  assert.ok(all[0].title && all[0].dek && all[0].logged);
  assert.ok(Array.isArray(all[0].tags) && all[0].tags.length > 0);
  assert.ok(Array.isArray(all[0].sections) && all[0].sections.length > 0);
});

test('getArticle returns the full shape for a seeded entry', () => {
  const all = db.getAllArticles();
  const article = db.getArticle(all[0].slug);
  assert.ok(article);
  assert.equal(article.slug, all[0].slug);
  assert.ok(article.sections.every((s) => s.heading && s.paragraphs.length > 0));
});

test('getArticle returns undefined for a missing slug', () => {
  assert.equal(db.getArticle('does-not-exist'), undefined);
});

test('createArticle inserts and records an audit entry', () => {
  db.createArticle(sample);
  const article = db.getArticle('test-entry');
  assert.ok(article);
  assert.equal(article.title, 'Test entry');
  assert.equal(article.sources?.[0].url, 'https://example.com');
  assert.equal(article.agentNotes, 'notes');
});

test('updateArticle is full-replace', () => {
  const updated = {
    ...sample,
    title: 'Updated title',
    tags: ['containment'],
    sections: [{ heading: 'New', paragraphs: ['Only one'] }],
    sources: undefined,
  };
  const ok = db.updateArticle('test-entry', updated);
  assert.equal(ok, true);
  const article = db.getArticle('test-entry');
  assert.equal(article?.title, 'Updated title');
  assert.deepEqual(article?.tags, ['containment']);
  assert.equal(article?.sections.length, 1);
  assert.equal(article?.sources, undefined, 'full-replace should drop removed children');
});

test('updateArticle returns false for a missing slug', () => {
  assert.equal(db.updateArticle('nope', sample), false);
});

test('deleteArticle removes the entry and returns true', () => {
  assert.equal(db.deleteArticle('test-entry'), true);
  assert.equal(db.getArticle('test-entry'), undefined);
  assert.equal(db.deleteArticle('test-entry'), false);
});

test('audit log records create/update/delete actions', () => {
  // Recreate to generate audit rows deterministically.
  db.createArticle({ ...sample, slug: 'audit-entry' });
  db.updateArticle('audit-entry', { ...sample, slug: 'audit-entry', title: 'Renamed' });
  db.deleteArticle('audit-entry');

  // Verify via a fresh read of the audit table through the same DB file.
  const raw = new DatabaseSync(process.env.DB_PATH as string, { readOnly: true });
  const rows = raw
    .prepare('SELECT action, slug FROM audit_log WHERE slug = ? ORDER BY id')
    .all('audit-entry') as unknown as { action: string; slug: string }[];
  raw.close();
  assert.deepEqual(
    rows.map((r) => r.action),
    ['create', 'update', 'delete'],
  );
});

// ---------------------------------------------------------------------------
// Site config
// ---------------------------------------------------------------------------

test('site config seeds with the generic framework defaults', () => {
  const config = db.getSiteConfig();
  assert.equal(config.siteTitle, 'Agentic Blog');
  assert.equal(
    config.siteDescription,
    'A self-hostable blog framework for AI agents — content published via a REST API and an MCP server.',
  );
  assert.equal(config.heroKicker, 'Agentic blog');
  assert.equal(config.heroTitle, 'A blog, written by agents');
  assert.equal(config.heroParagraphs.length, 2);
  assert.match(config.heroParagraphs[0], /Agentic Blog framework/);
  assert.match(config.footerText, /Agentic Blog framework/);
  assert.match(config.footerDisclaimer, /written by AI agents/);
  assert.equal(config.robotsIndex, false);
  assert.equal(config.homepageCap, 25);
});

test('updateSiteConfig is a partial merge', () => {
  const before = db.getSiteConfig();
  const updated = db.updateSiteConfig({ heroTitle: 'A new hero title', homepageCap: 10 });
  assert.equal(updated.heroTitle, 'A new hero title');
  assert.equal(updated.homepageCap, 10);
  // Untouched fields keep their values.
  assert.equal(updated.siteTitle, before.siteTitle);
  assert.equal(updated.heroKicker, before.heroKicker);
  assert.deepEqual(updated.heroParagraphs, before.heroParagraphs);
  // Restore for other tests.
  db.updateSiteConfig({ heroTitle: before.heroTitle, homepageCap: before.homepageCap });
});

test('updateSiteConfig persists robotsIndex and records an audit entry', () => {
  db.updateSiteConfig({ robotsIndex: true });
  assert.equal(db.getSiteConfig().robotsIndex, true);
  db.updateSiteConfig({ robotsIndex: false });
  assert.equal(db.getSiteConfig().robotsIndex, false);

  const raw = new DatabaseSync(process.env.DB_PATH as string, { readOnly: true });
  const rows = raw
    .prepare("SELECT action, slug FROM audit_log WHERE slug = 'site_config' ORDER BY id")
    .all() as unknown as { action: string; slug: string }[];
  raw.close();
  assert.ok(rows.length >= 2, 'expected audit entries for config updates');
  assert.ok(rows.every((r) => r.action === 'update' && r.slug === 'site_config'));
});

test('theme seeds with the default values and no hero image', () => {
  const theme = db.getSiteConfig().theme;
  assert.deepEqual(theme.colors, {
    ink: '#0a0c0f',
    paper: '#eef1f0',
    signal: '#5eead4',
    signalDim: '#2dd4bf',
    line: '#1f2a2e',
    muted: '#8b979a',
  });
  assert.deepEqual(theme.fonts, { display: 'Space Grotesk', body: 'Inter', mono: 'JetBrains Mono' });
  assert.equal(theme.heroImageUrl, '');
});

test('updateSiteConfig merges theme sub-fields partially', () => {
  const before = db.getSiteConfig().theme;
  const updated = db.updateSiteConfig({
    theme: { colors: { signal: '#ff0000' }, fonts: { display: 'Georgia' } },
  });
  assert.equal(updated.theme.colors.signal, '#ff0000');
  assert.equal(updated.theme.fonts.display, 'Georgia');
  // Untouched theme fields keep their values.
  assert.equal(updated.theme.colors.ink, before.colors.ink);
  assert.equal(updated.theme.colors.paper, before.colors.paper);
  assert.equal(updated.theme.fonts.body, before.fonts.body);
  assert.equal(updated.theme.heroImageUrl, before.heroImageUrl);

  // Restore.
  db.updateSiteConfig({ theme: { colors: { signal: before.colors.signal }, fonts: { display: before.fonts.display } } });
  assert.deepEqual(db.getSiteConfig().theme, before);
});

test('feedEnabled defaults to false (private posture)', () => {
  assert.equal(db.getSiteConfig().feedEnabled, false);
  db.updateSiteConfig({ feedEnabled: true });
  assert.equal(db.getSiteConfig().feedEnabled, true);
  db.updateSiteConfig({ feedEnabled: false });
  assert.equal(db.getSiteConfig().feedEnabled, false);
});

// ---------------------------------------------------------------------------
// Import (merge by slug)
// ---------------------------------------------------------------------------

test('importArticles upserts by slug', () => {
  const summary = db.importArticles(
    [
      { ...sample, slug: 'import-new', title: 'Imported new' },
      { ...sample, slug: 'import-existing', title: 'Imported existing' },
    ],
    { deleteMissing: false },
  );
  assert.deepEqual(summary, { created: 2, updated: 0, deleted: 0 });
  assert.equal(db.getArticle('import-new')?.title, 'Imported new');

  // Re-import with a changed title on one entry → update, not create.
  const second = db.importArticles(
    [
      { ...sample, slug: 'import-new', title: 'Imported new v2' },
      { ...sample, slug: 'import-existing', title: 'Imported existing' },
    ],
    { deleteMissing: false },
  );
  assert.deepEqual(second, { created: 0, updated: 2, deleted: 0 });
  assert.equal(db.getArticle('import-new')?.title, 'Imported new v2');
});

test('importArticles never deletes unless deleteMissing is true', () => {
  db.importArticles([{ ...sample, slug: 'import-existing', title: 'Keep me' }], {
    deleteMissing: false,
  });
  assert.ok(db.getArticle('import-new'), 'import-new must survive a non-deleting import');

  // deleteMissing: true removes every DB entry absent from the batch — the
  // sample entry plus import-new (import-existing is in the batch).
  const summary = db.importArticles([{ ...sample, slug: 'import-existing', title: 'Keep me' }], {
    deleteMissing: true,
  });
  assert.equal(summary.deleted, 2);
  assert.equal(db.getArticle('import-new'), undefined);
  assert.ok(db.getArticle('import-existing'));
});

test('importArticles rolls back the whole import on error', () => {
  // A valid entry followed by one that violates the status CHECK constraint.
  // The valid entry must also be rolled back — the import is transactional.
  assert.throws(() =>
    db.importArticles(
      [
        { ...sample, slug: 'rollback-valid', title: 'Should be rolled back' },
        { ...sample, slug: 'rollback-bad', title: 'Bad', status: 'bogus' as Article['status'] },
      ],
      { deleteMissing: false },
    ),
  );
  assert.equal(db.getArticle('rollback-valid'), undefined, 'valid entry must be rolled back too');
  assert.equal(db.getArticle('rollback-bad'), undefined);
});

// ---------------------------------------------------------------------------
// Full-text search (FTS5)
// ---------------------------------------------------------------------------

test('searchArticles matches title, body, and tag content', () => {
  db.createArticle({
    ...sample,
    slug: 'search-title',
    title: 'Reward hacking in RL',
    tags: ['alignment'],
    sections: [{ heading: 'Setup', paragraphs: ['A paragraph about reward hacking.'] }],
  });
  db.createArticle({
    ...sample,
    slug: 'search-tag',
    title: 'Unrelated title',
    tags: ['alignment'],
    sections: [{ heading: 'H', paragraphs: ['No mention of the term here.'] }],
  });

  // Title match.
  const byTitle = db.searchArticles('reward');
  assert.ok(byTitle.some((r) => r.slug === 'search-title'));

  // Body match.
  const byBody = db.searchArticles('paragraph');
  assert.ok(byBody.some((r) => r.slug === 'search-title'));

  // Tag match — 'alignment' never appears in the title or body of search-tag.
  const byTag = db.searchArticles('alignment');
  assert.ok(byTag.some((r) => r.slug === 'search-tag'));
});

test('searchArticles is case-insensitive and supports prefix matching', () => {
  db.createArticle({
    ...sample,
    slug: 'search-prefix',
    title: 'Sandboxing experiments',
    sections: [{ heading: 'H', paragraphs: ['The sandbox environment is isolated.'] }],
  });

  const upper = db.searchArticles('SANDBOX');
  assert.ok(upper.some((r) => r.slug === 'search-prefix'));

  const prefix = db.searchArticles('sand');
  assert.ok(prefix.some((r) => r.slug === 'search-prefix'), 'prefix "sand" must match "sandbox"');
});

test('searchArticles snippet contains the matched term', () => {
  db.createArticle({
    ...sample,
    slug: 'search-snippet',
    title: 'Snippet test',
    sections: [{ heading: 'H', paragraphs: ['The quasar observation was recorded at dawn.'] }],
  });

  const results = db.searchArticles('quasar');
  const hit = results.find((r) => r.slug === 'search-snippet');
  assert.ok(hit);
  assert.match(hit.snippet, /quasar/);
});

test('searchArticles sanitizes FTS5 operators instead of throwing', () => {
  // Raw FTS5 operators would normally throw a syntax error in MATCH.
  assert.doesNotThrow(() => db.searchArticles('operator OR - " *'));
  assert.deepEqual(db.searchArticles('zzz OR - " *'), []);
});

test('searchArticles returns [] for empty, whitespace, punctuation-only, and unmatched queries', () => {
  assert.deepEqual(db.searchArticles(''), []);
  assert.deepEqual(db.searchArticles('   '), []);
  assert.deepEqual(db.searchArticles('!!! ???'), []);
  assert.deepEqual(db.searchArticles('nonexistenttermxyz'), []);
});

test('searchArticles respects the limit', () => {
  for (let i = 0; i < 3; i++) {
    db.createArticle({
      ...sample,
      slug: `search-limit-${i}`,
      title: `Limit test ${i}`,
      sections: [{ heading: 'H', paragraphs: ['Common body term for limiting.'] }],
    });
  }
  const results = db.searchArticles('limiting', 2);
  assert.equal(results.length, 2);
});

test('searchArticles publishedOnly excludes drafts and archived entries', () => {
  db.createArticle({
    ...sample,
    slug: 'search-draft',
    title: 'Draft quasar notes',
    status: 'draft',
    sections: [{ heading: 'H', paragraphs: ['Draft body about quasars.'] }],
  });

  const publicResults = db.searchArticles('quasar', 10, { publishedOnly: true });
  assert.ok(!publicResults.some((r) => r.slug === 'search-draft'), 'drafts must not leak publicly');

  const allResults = db.searchArticles('quasar');
  assert.ok(allResults.some((r) => r.slug === 'search-draft'), 'management search sees drafts');
});

test('publishedOnly filters in SQL before the limit — a draft ranking above published matches cannot hide them', () => {
  // The draft matches 'zephyr' in three FTS columns (title, body, tags) so it
  // ranks above the published article (body only). With limit=1 the published
  // article must still be returned: the status filter applies before LIMIT.
  db.createArticle({
    ...sample,
    slug: 'search-draft-first',
    title: 'zephyr',
    status: 'draft',
    tags: ['zephyr'],
    sections: [{ heading: 'H', paragraphs: ['zephyr'] }],
  });
  db.createArticle({
    ...sample,
    slug: 'search-published-second',
    title: 'Published article',
    sections: [{ heading: 'H', paragraphs: ['zephyr zephyr zephyr'] }],
  });

  const results = db.searchArticles('zephyr', 1, { publishedOnly: true });
  assert.deepEqual(
    results.map((r) => r.slug),
    ['search-published-second'],
    'the published article must win the single slot over the higher-ranked draft',
  );
});

test('FTS index stays in sync across update and delete', () => {
  db.createArticle({
    ...sample,
    slug: 'search-sync',
    title: 'Sync old term',
    sections: [{ heading: 'H', paragraphs: ['Contains syncoldterm.'] }],
  });
  assert.ok(db.searchArticles('syncoldterm').some((r) => r.slug === 'search-sync'));

  db.updateArticle('search-sync', {
    ...sample,
    slug: 'search-sync',
    title: 'Sync new term',
    sections: [{ heading: 'H', paragraphs: ['Contains syncnewterm.'] }],
  });
  assert.ok(!db.searchArticles('syncoldterm').some((r) => r.slug === 'search-sync'), 'old term must stop matching');
  assert.ok(db.searchArticles('syncnewterm').some((r) => r.slug === 'search-sync'), 'new term must match');

  db.deleteArticle('search-sync');
  assert.ok(!db.searchArticles('syncnewterm').some((r) => r.slug === 'search-sync'), 'deleted article must not match');
});

// NOTE: this test must stay last in the file — deleteMissing: true wipes every
// other article (including the seeded sample), so tests after it would find an
// empty DB.
test('importArticles with deleteMissing removes the FTS row too', () => {
  db.createArticle({
    ...sample,
    slug: 'search-import-delete',
    title: 'Import delete term',
    sections: [{ heading: 'H', paragraphs: ['Contains importdeleteterm.'] }],
  });
  assert.ok(db.searchArticles('importdeleteterm').some((r) => r.slug === 'search-import-delete'));

  db.importArticles([{ ...sample, slug: 'search-import-delete', title: 'Import delete term' }], {
    deleteMissing: true,
  });
  assert.ok(
    !db.searchArticles('importdeleteterm').some((r) => r.slug === 'search-import-delete'),
    'deleteMissing must clean up the FTS row',
  );
});