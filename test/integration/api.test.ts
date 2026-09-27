import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Integration layer: builds (via `npm run test:integration`) and starts the
 * real Next server against a throwaway DB, then exercises the HTTP API with
 * fetch. Route handlers import `next/server`, so they are tested through a
 * running server rather than imported directly.
 */

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'integration-test-token-abc123';
const tempDir = mkdtempSync(path.join(tmpdir(), 'agentic-blog-int-'));
const dbPath = path.join(tempDir, 'int.db');

let server: ChildProcess;

async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not become ready');
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...extra };
}

const sample = {
  title: 'Integration test entry',
  dek: 'Created through the HTTP API',
  logged: '2026-09-15',
  status: 'published',
  tags: ['oversight'],
  sections: [{ heading: 'Setup', paragraphs: ['A paragraph written by the integration test.'] }],
};

before(async () => {
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)],
    {
      env: { ...process.env, DB_PATH: dbPath, CONTENT_API_TOKEN: TOKEN, SEED_SAMPLE: '1', TRUST_PROXY: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await waitForServer();
});

after(() => {
  server?.kill();
  rmSync(tempDir, { recursive: true, force: true });
});

test('homepage renders and serves the site title', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Agentic Blog/);
});

test('openapi spec is served', async () => {
  const res = await fetch(`${BASE}/openapi.json`);
  assert.equal(res.status, 200);
  const spec = (await res.json()) as { info?: { title?: string } };
  assert.ok(spec.info?.title);
});

test('API rejects requests without a bearer token (401)', async () => {
  const res = await fetch(`${BASE}/api/articles`);
  assert.equal(res.status, 401);
});

test('GET /api/articles returns seeded entries with auth', async () => {
  const res = await fetch(`${BASE}/api/articles`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { articles: unknown[] };
  assert.ok(Array.isArray(body.articles) && body.articles.length > 0);
});

test('POST creates an article, GET/PATCH/DELETE round-trip', async () => {
  // create
  const created = await fetch(`${BASE}/api/articles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(sample),
  });
  assert.equal(created.status, 201);
  const createdBody = (await created.json()) as { article: { slug: string } };
  const slug = createdBody.article.slug;
  assert.equal(slug, 'integration-test-entry');

  // read back
  const got = await fetch(`${BASE}/api/articles/${slug}`, { headers: authHeaders() });
  assert.equal(got.status, 200);
  const gotBody = (await got.json()) as { article: { title: string } };
  assert.equal(gotBody.article.title, 'Integration test entry');

  // update (full-replace)
  const patched = await fetch(`${BASE}/api/articles/${slug}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ ...sample, slug, title: 'Renamed by integration test' }),
  });
  assert.equal(patched.status, 200);
  const patchedBody = (await patched.json()) as { article: { title: string } };
  assert.equal(patchedBody.article.title, 'Renamed by integration test');

  // delete
  const deleted = await fetch(`${BASE}/api/articles/${slug}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  assert.equal(deleted.status, 200);
  const gone = await fetch(`${BASE}/api/articles/${slug}`, { headers: authHeaders() });
  assert.equal(gone.status, 404);
});

test('POST rejects invalid bodies with 400', async () => {
  const res = await fetch(`${BASE}/api/articles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title: '', dek: '', logged: '', status: 'bogus', tags: [], sections: [] }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { details?: string[] };
  assert.ok(Array.isArray(body.details) && body.details.length > 0);
});

test('POST rejects duplicate slugs with 409', async () => {
  const first = await fetch(`${BASE}/api/articles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ...sample, title: 'Duplicate slug test' }),
  });
  assert.equal(first.status, 201);
  const second = await fetch(`${BASE}/api/articles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ...sample, title: 'Duplicate slug test' }),
  });
  assert.equal(second.status, 409);
});

test('rate limiter returns 429 after the per-window cap (isolated IP)', async () => {
  // Note: use x-forwarded-for, not x-real-ip — Next.js overwrites x-real-ip
  // with the socket address, so all local requests would share one bucket.
  const headers = authHeaders({ 'x-forwarded-for': '198.51.100.77' });
  let lastStatus = 0;
  for (let i = 0; i < 121; i++) {
    const res = await fetch(`${BASE}/api/articles`, { headers });
    lastStatus = res.status;
    if (res.status === 429) break;
  }
  assert.equal(lastStatus, 429);
});

// ---------------------------------------------------------------------------
// Site config
// ---------------------------------------------------------------------------

test('GET /api/site-config requires auth (401)', async () => {
  const res = await fetch(`${BASE}/api/site-config`);
  assert.equal(res.status, 401);
});

test('GET /api/site-config returns the seeded baseline config', async () => {
  const res = await fetch(`${BASE}/api/site-config`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { siteConfig: { siteTitle: string; heroTitle: string; robotsIndex: boolean; homepageCap: number } };
  assert.equal(body.siteConfig.siteTitle, 'Agentic Blog');
  assert.equal(body.siteConfig.heroTitle, 'A blog, written by agents');
  assert.equal(body.siteConfig.robotsIndex, false);
  assert.equal(body.siteConfig.homepageCap, 25);
});

test('PATCH /api/site-config applies a partial update and reflects it on the homepage', async () => {
  const patched = await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ heroTitle: 'Patched hero title' }),
  });
  assert.equal(patched.status, 200);
  const patchedBody = (await patched.json()) as { siteConfig: { heroTitle: string; siteTitle: string } };
  assert.equal(patchedBody.siteConfig.heroTitle, 'Patched hero title');
  assert.equal(patchedBody.siteConfig.siteTitle, 'Agentic Blog', 'untouched fields preserved');

  const home = await fetch(`${BASE}/`);
  const html = await home.text();
  assert.match(html, /Patched hero title/);

  // Restore the baseline value.
  const restored = await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ heroTitle: 'A blog, written by agents' }),
  });
  assert.equal(restored.status, 200);
});

test('PATCH /api/site-config rejects invalid fields with 400', async () => {
  const res = await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ siteUrl: 'javascript:alert(1)', homepageCap: 0 }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { details?: string[] };
  assert.ok(Array.isArray(body.details) && body.details.length >= 2);
});

test('robots toggle: noindex by default, index when robotsIndex=true', async () => {
  const before = await fetch(`${BASE}/`);
  assert.match(await before.text(), /noindex, nofollow, nocache/);

  const patched = await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ robotsIndex: true }),
  });
  assert.equal(patched.status, 200);

  const after = await fetch(`${BASE}/`);
  const html = await after.text();
  assert.doesNotMatch(html, /noindex/);
  assert.match(html, /index, follow/);

  // Restore.
  await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ robotsIndex: false }),
  });
});

test('robots.txt follows the robotsIndex toggle', async () => {
  const disallowed = await fetch(`${BASE}/robots.txt`);
  assert.match(await disallowed.text(), /Disallow: \//);

  await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ robotsIndex: true }),
  });
  const allowed = await fetch(`${BASE}/robots.txt`);
  const text = await allowed.text();
  assert.doesNotMatch(text, /Disallow/);
  assert.match(text, /Allow: \//);

  await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ robotsIndex: false }),
  });
});

test('PATCH /api/site-config rejects oversized bodies with 413', async () => {
  const res = await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ siteTitle: 'x'.repeat(70_000) }),
  });
  assert.equal(res.status, 413);
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

test('default theme renders the baseline colors and no runtime font links', async () => {
  const res = await fetch(`${BASE}/`);
  const html = await res.text();
  // The ThemeProvider emits :root overrides with the default palette.
  assert.match(html, /--color-ink:#0a0c0f/);
  assert.match(html, /--color-signal:#5eead4/);
  // Default fonts are loaded by next/font — no runtime Google Fonts links.
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
});

test('PATCH theme applies colors and runtime font links to the homepage', async () => {
  const patched = await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      theme: { colors: { signal: '#ff0000' }, fonts: { display: 'Roboto' } },
    }),
  });
  assert.equal(patched.status, 200);
  const body = (await patched.json()) as {
    siteConfig: { theme: { colors: { signal: string }; fonts: { display: string } } };
  };
  assert.equal(body.siteConfig.theme.colors.signal, '#ff0000');
  assert.equal(body.siteConfig.theme.fonts.display, 'Roboto');

  const home = await fetch(`${BASE}/`);
  const html = await home.text();
  assert.match(html, /--color-signal:#ff0000/);
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=Roboto/);
  assert.match(html, /--font-display:'Roboto'/);

  // Restore the baseline theme.
  const restored = await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      theme: { colors: { signal: '#5eead4' }, fonts: { display: 'Space Grotesk' } },
    }),
  });
  assert.equal(restored.status, 200);
});

test('PATCH theme rejects invalid colors and fonts with 400', async () => {
  const badColor = await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ theme: { colors: { ink: 'not-a-color' } } }),
  });
  assert.equal(badColor.status, 400);

  const badFont = await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ theme: { fonts: { body: 'Comic Sans MS' } } }),
  });
  assert.equal(badFont.status, 400);

  const badHero = await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ theme: { heroImageUrl: 'javascript:alert(1)' } }),
  });
  assert.equal(badHero.status, 400);
});

// ---------------------------------------------------------------------------
// RSS feed + export/import
// ---------------------------------------------------------------------------

test('feed is disabled by default (404)', async () => {
  const res = await fetch(`${BASE}/feed.xml`);
  assert.equal(res.status, 404);
});

test('feed serves valid RSS XML when feedEnabled is true', async () => {
  await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ feedEnabled: true }),
  });
  const res = await fetch(`${BASE}/feed.xml`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/rss\+xml/);
  const xml = await res.text();
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<rss version="2.0"/);
  assert.match(xml, /<item>/);
  assert.match(xml, /<title>Agentic Blog<\/title>/);

  // Restore.
  await fetch(`${BASE}/api/site-config`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ feedEnabled: false }),
  });
});

test('GET /api/export returns all entries plus site config', async () => {
  const res = await fetch(`${BASE}/api/export`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    version: number;
    articles: unknown[];
    siteConfig: { siteTitle: string };
  };
  assert.equal(body.version, 1);
  assert.ok(Array.isArray(body.articles) && body.articles.length > 0);
  assert.equal(body.siteConfig.siteTitle, 'Agentic Blog');
});

test('export → import round-trips byte-identical', async () => {
  const exported = (await (await fetch(`${BASE}/api/export`, { headers: authHeaders() })).json()) as {
    articles: unknown[];
    siteConfig: unknown;
  };

  const imported = await fetch(`${BASE}/api/import`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ articles: exported.articles }),
  });
  assert.equal(imported.status, 200);
  const summary = (await imported.json()) as { summary: { created: number; updated: number; deleted: number } };
  assert.equal(summary.summary.created, 0, 'all slugs already exist');
  assert.ok(summary.summary.updated > 0);

  const reExported = (await (await fetch(`${BASE}/api/export`, { headers: authHeaders() })).json()) as {
    articles: unknown[];
  };
  assert.deepEqual(reExported.articles, exported.articles, 'round-trip must be byte-identical');
});

test('POST /api/import rejects invalid entries with 400 and writes nothing', async () => {
  const before = (await (await fetch(`${BASE}/api/export`, { headers: authHeaders() })).json()) as {
    articles: unknown[];
  };
  const res = await fetch(`${BASE}/api/import`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      articles: [
        { title: '', dek: '', logged: '', status: 'bogus', tags: [], sections: [] },
      ],
    }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { details?: string[] };
  assert.ok(Array.isArray(body.details) && body.details.length > 0);

  const after = (await (await fetch(`${BASE}/api/export`, { headers: authHeaders() })).json()) as {
    articles: unknown[];
  };
  assert.deepEqual(after.articles, before.articles, 'failed import must not change anything');
});

test('POST /api/import with deleteMissing removes absent slugs', async () => {
  // Create a throwaway entry, then import without it and deleteMissing: true.
  await fetch(`${BASE}/api/articles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ...sample, title: 'Throwaway for deleteMissing' }),
  });
  const exported = (await (await fetch(`${BASE}/api/export`, { headers: authHeaders() })).json()) as {
    articles: { slug: string }[];
  };
  const kept = exported.articles.filter((cs) => cs.slug !== 'throwaway-for-deletemissing');

  const res = await fetch(`${BASE}/api/import`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ articles: kept, deleteMissing: true }),
  });
  assert.equal(res.status, 200);
  const summary = (await res.json()) as { summary: { deleted: number } };
  assert.equal(summary.summary.deleted, 1);

  const gone = await fetch(`${BASE}/api/articles/throwaway-for-deletemissing`, {
    headers: authHeaders(),
  });
  assert.equal(gone.status, 404);
});

test('POST /api/import rejects oversized bodies with 413 and too many entries with 400', async () => {
  const oversized = await fetch(`${BASE}/api/import`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ articles: [{ title: 'x'.repeat(5_000_000) }] }),
  });
  assert.equal(oversized.status, 413);

  const tooMany = await fetch(`${BASE}/api/import`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ articles: Array.from({ length: 1001 }, () => sample) }),
  });
  assert.equal(tooMany.status, 400);
});

// ---------------------------------------------------------------------------
// Full-text search
// ---------------------------------------------------------------------------

test('GET /api/search is public and returns ranked results', async () => {
  const created = await fetch(`${BASE}/api/articles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      ...sample,
      title: 'Reward hacking in RL',
      tags: ['alignment'],
      sections: [{ heading: 'Setup', paragraphs: ['A paragraph about reward hacking.'] }],
    }),
  });
  assert.equal(created.status, 201);

  // No bearer token — public by design.
  const res = await fetch(`${BASE}/api/search?q=reward`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { query: string; results: { slug: string; snippet: string }[] };
  assert.equal(body.query, 'reward');
  assert.ok(body.results.some((r) => r.slug === 'reward-hacking-in-rl'));
  assert.match(body.results[0].snippet, /reward/);
});

test('GET /api/search matches body content and tags', async () => {
  // 'alignment' appears only in the tags of the article created above.
  const byTag = await fetch(`${BASE}/api/search?q=alignment`);
  assert.equal(byTag.status, 200);
  const tagBody = (await byTag.json()) as { results: { slug: string }[] };
  assert.ok(tagBody.results.some((r) => r.slug === 'reward-hacking-in-rl'));

  // Body match.
  const byBody = await fetch(`${BASE}/api/search?q=paragraph`);
  assert.equal(byBody.status, 200);
  const bodyRes = (await byBody.json()) as { results: { slug: string }[] };
  assert.ok(bodyRes.results.some((r) => r.slug === 'reward-hacking-in-rl'));
});

test('GET /api/search rejects short and long queries with 400', async () => {
  const short = await fetch(`${BASE}/api/search?q=a`);
  assert.equal(short.status, 400);

  const long = await fetch(`${BASE}/api/search?q=${'x'.repeat(101)}`);
  assert.equal(long.status, 400);
});

test('GET /api/search sanitizes FTS5 operators instead of erroring', async () => {
  const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent('operator OR - " *')}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { results: unknown[] };
  assert.ok(Array.isArray(body.results));
});

test('GET /api/search respects the limit param', async () => {
  const res = await fetch(`${BASE}/api/search?q=reward&limit=1`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { results: unknown[] };
  assert.equal(body.results.length, 1);
});

test('GET /api/search never returns drafts or archived entries', async () => {
  await fetch(`${BASE}/api/articles`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      ...sample,
      title: 'Draft quasar notes',
      status: 'draft',
      sections: [{ heading: 'H', paragraphs: ['Draft body about quasars.'] }],
    }),
  });

  const res = await fetch(`${BASE}/api/search?q=quasar`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { results: { slug: string }[] };
  assert.ok(!body.results.some((r) => r.slug === 'draft-quasar-notes'), 'drafts must not leak');
});

test('GET /api/articles?q= requires auth and searches every status', async () => {
  // Unauthenticated → 401.
  const noAuth = await fetch(`${BASE}/api/articles?q=quasar`);
  assert.equal(noAuth.status, 401);

  // Authenticated → finds the draft (management surface).
  const res = await fetch(`${BASE}/api/articles?q=quasar`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { articles: { slug: string; status: string }[] };
  assert.ok(body.articles.some((a) => a.slug === 'draft-quasar-notes' && a.status === 'draft'));

  // Invalid query length → 400.
  const bad = await fetch(`${BASE}/api/articles?q=a`, { headers: authHeaders() });
  assert.equal(bad.status, 400);
});

test('homepage paginates at homepageCap with /?page=N', async () => {
  // homepageCap defaults to 25 — publish 26 published articles so the
  // homepage spans two pages.
  for (let i = 0; i < 26; i++) {
    const res = await fetch(`${BASE}/api/articles`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        ...sample,
        title: `Pagination entry ${i}`,
        logged: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
        sections: [{ heading: 'H', paragraphs: [`Pagination body ${i}.`] }],
      }),
    });
    assert.equal(res.status, 201);
  }

  const page1 = await fetch(`${BASE}/`);
  const page1Html = (await page1.text()).replace(/<!--.*?-->/g, '');
  assert.match(page1Html, /Page 1 of 2/);

  const page2 = await fetch(`${BASE}/?page=2`);
  assert.equal(page2.status, 200);
  const page2Html = (await page2.text()).replace(/<!--.*?-->/g, '');
  assert.match(page2Html, /Page 2 of 2/);

  // The newest entry lives on page 1 only.
  assert.match(page1Html, /Pagination entry 25/);
  assert.doesNotMatch(page2Html, /Pagination entry 25/);
});

test('status index pages list published articles and 404 on unknown status', async () => {
  const published = await fetch(`${BASE}/status/published`);
  assert.equal(published.status, 200);
  const publishedHtml = (await published.text()).replace(/<!--.*?-->/g, '');
  assert.match(publishedHtml, /Published/);
  assert.match(publishedHtml, /Pagination entry 25/);

  // Drafts never render on the public site, so the draft status page is empty.
  const draft = await fetch(`${BASE}/status/draft`);
  assert.equal(draft.status, 200);
  const draftHtml = (await draft.text()).replace(/<!--.*?-->/g, '');
  assert.doesNotMatch(draftHtml, /draft-quasar-notes/);

  const bogus = await fetch(`${BASE}/status/bogus`);
  assert.equal(bogus.status, 404);
});

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

test('POST /api/feedback is public and stores a submission', async () => {
  // No bearer token — submission is unauthenticated by design. Isolated
  // X-Forwarded-For so the strict per-IP rate limit does not bleed between
  // tests (the test server has no proxy, so all requests would otherwise
  // share one bucket).
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.10' };
  const res = await fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: 'Correction on the sample entry.',
      name: 'Integration Tester',
      email: 'tester@example.com',
      articleSlug: 'welcome',
    }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { ok: boolean; id: number };
  assert.equal(body.ok, true);
  assert.ok(Number.isInteger(body.id) && body.id > 0);
});

test('POST /api/feedback silently discards honeypot submissions', async () => {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.11' };
  const res = await fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: 'spam', website: 'http://spam.example' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, true);

  // The honeypot submission must not appear in the inbox.
  const inbox = await fetch(`${BASE}/api/feedback`, { headers: authHeaders() });
  const inboxBody = (await inbox.json()) as { feedback: { message: string }[] };
  assert.ok(!inboxBody.feedback.some((f) => f.message === 'spam'));
});

test('POST /api/feedback discards non-string honeypot values too', async () => {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.12' };
  for (const website of [true, 123, ['x'], { url: 'x' }]) {
    const res = await fetch(`${BASE}/api/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'spam', website }),
    });
    assert.equal(res.status, 200, `honeypot value ${JSON.stringify(website)} should be discarded`);
  }
});

test('POST /api/feedback rejects non-JSON content types with 415', async () => {
  const headers = { 'content-type': 'text/plain', 'x-forwarded-for': '198.51.100.13' };
  const res = await fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: 'cross-origin spam' }),
  });
  assert.equal(res.status, 415);
});

test('POST /api/feedback strict rate limit holds even after priming via /api/search', async () => {
  // The strict feedback bucket must not be primed away by the laxer default
  // bucket: hit the public search endpoint first, then verify the feedback
  // cap (5 / 10 min) still applies to the same client key.
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.99' };
  const prime = await fetch(`${BASE}/api/search?q=sample`, { headers });
  assert.equal(prime.status, 200);

  let lastStatus = 0;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${BASE}/api/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: `rate test ${i}` }),
    });
    lastStatus = res.status;
    if (res.status === 429) break;
  }
  assert.equal(lastStatus, 429, '6th feedback submission should be rate limited');
});

test('POST /api/feedback rejects invalid bodies with 400', async () => {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.14' };
  const res = await fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: '', email: 'not-an-email' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { details?: string[] };
  assert.ok(Array.isArray(body.details) && body.details.length > 0);
});

test('POST /api/feedback with a non-existent articleSlug still succeeds (no 500, no oracle)', async () => {
  // The feedback table's FK rejects unknown slugs; the route must drop the
  // association and store the feedback alone — uniformly 201, never a 500
  // (and never a 400 that would reveal whether a slug exists).
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.15' };
  const res = await fetch(`${BASE}/api/feedback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: 'Feedback about a deleted article.', articleSlug: 'no-such-article' }),
  });
  assert.equal(res.status, 201);

  const inbox = await fetch(`${BASE}/api/feedback`, { headers: authHeaders() });
  const inboxBody = (await inbox.json()) as {
    feedback: { message: string; articleSlug?: string }[];
  };
  const hit = inboxBody.feedback.find((f) => f.message === 'Feedback about a deleted article.');
  assert.ok(hit, 'feedback should be stored');
  assert.equal(hit.articleSlug, undefined, 'unknown slug must be dropped, not stored');
});

test('GET /api/feedback requires auth (401)', async () => {
  const res = await fetch(`${BASE}/api/feedback`);
  assert.equal(res.status, 401);
});

test('GET /api/feedback lists submissions with auth', async () => {
  const res = await fetch(`${BASE}/api/feedback`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    feedback: { message: string; status: string; articleSlug?: string }[];
  };
  assert.ok(Array.isArray(body.feedback) && body.feedback.length > 0);
  const hit = body.feedback.find((f) => f.message === 'Correction on the sample entry.');
  assert.ok(hit, 'submitted feedback should be listed');
  assert.equal(hit.status, 'new');
  assert.equal(hit.articleSlug, 'welcome');
});

test('GET /api/feedback filters by status and rejects bad status', async () => {
  const res = await fetch(`${BASE}/api/feedback?status=new`, { headers: authHeaders() });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { feedback: { status: string }[] };
  assert.ok(body.feedback.every((f) => f.status === 'new'));

  const bad = await fetch(`${BASE}/api/feedback?status=bogus`, { headers: authHeaders() });
  assert.equal(bad.status, 400);
});

test('PATCH /api/feedback/{id} requires auth and updates status', async () => {
  // Find a submission id first.
  const inbox = await fetch(`${BASE}/api/feedback`, { headers: authHeaders() });
  const inboxBody = (await inbox.json()) as { feedback: { id: number }[] };
  const id = inboxBody.feedback[0].id;

  const noAuth = await fetch(`${BASE}/api/feedback/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'acknowledged' }),
  });
  assert.equal(noAuth.status, 401);

  const res = await fetch(`${BASE}/api/feedback/${id}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'acknowledged' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { feedback: { id: number; status: string } };
  assert.equal(body.feedback.id, id);
  assert.equal(body.feedback.status, 'acknowledged');
});

test('PATCH /api/feedback/{id} rejects bad id, bad status, and unknown id', async () => {
  const badId = await fetch(`${BASE}/api/feedback/not-a-number`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'new' }),
  });
  assert.equal(badId.status, 400);

  const badStatus = await fetch(`${BASE}/api/feedback/1`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'bogus' }),
  });
  assert.equal(badStatus.status, 400);

  const unknown = await fetch(`${BASE}/api/feedback/999999`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status: 'new' }),
  });
  assert.equal(unknown.status, 404);
});