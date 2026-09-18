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