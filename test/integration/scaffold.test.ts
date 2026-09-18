import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * End-to-end scaffold test: run create-blog.mjs into a temp dir, build the
 * scaffolded site, start it, and verify it serves the scaffolded identity
 * and answers the API with the freshly generated token.
 */

const REPO = path.resolve(import.meta.dirname, '..', '..');
const PORT = 3195;
const BASE = `http://localhost:${PORT}`;

const tempRoot = mkdtempSync(path.join(tmpdir(), 'agentic-blog-scaffold-'));
const siteDir = path.join(tempRoot, 'site');
const dbPath = path.join(tempRoot, 'scaffold.db');

const SITE_NAME = 'Scaffold Test Blog';
const SITE_URL = 'https://scaffold-test.example';
const SITE_DESC = 'A blog created by the scaffold test';

let token = '';
let server: ChildProcess;

function run(cmd: string, args: string[], opts: { cwd: string; timeout?: number }) {
  return execFileSync(cmd, args, {
    cwd: opts.cwd,
    timeout: opts.timeout ?? 180_000,
    stdio: 'pipe',
    env: { ...process.env, NVM_DIR: process.env.NVM_DIR ?? '' },
  });
}

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
  throw new Error('scaffolded server did not become ready');
}

before(async () => {
  // 1. Scaffold non-interactively.
  run(
    process.execPath,
    ['create-blog.mjs', siteDir, '--name', SITE_NAME, '--url', SITE_URL, '--description', SITE_DESC],
    { cwd: REPO },
  );

  // 2. Reuse the source repo's node_modules (no network in tests).
  symlinkSync(path.join(REPO, 'node_modules'), path.join(siteDir, 'node_modules'), 'dir');

  // 3. Build the scaffolded site.
  run('npm', ['run', 'build'], { cwd: siteDir });

  // 4. Read the generated token and start the server against a throwaway DB.
  const envLocal = readFileSync(path.join(siteDir, '.env.local'), 'utf8');
  const match = envLocal.match(/^CONTENT_API_TOKEN=(.+)$/m);
  assert.ok(match, '.env.local must contain CONTENT_API_TOKEN');
  token = match[1];
  assert.match(token, /^[0-9a-f]{64}$/, 'token must be 64 hex chars');

  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)],
    {
      cwd: siteDir,
      env: { ...process.env, DB_PATH: dbPath, CONTENT_API_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await waitForServer();
});

after(() => {
  server?.kill();
  rmSync(tempRoot, { recursive: true, force: true });
});

test('scaffolded site serves its own identity', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, new RegExp(SITE_NAME));
  assert.match(html, /A blog, written by agents/, 'default hero copy is preserved');
});

test('scaffolded site starts with empty content', async () => {
  const res = await fetch(`${BASE}/api/articles`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { articles: unknown[] };
  assert.deepEqual(body.articles, [], 'a fresh scaffold has no content');
});

test('scaffolded API answers with the new token and rejects without it', async () => {
  const denied = await fetch(`${BASE}/api/articles`);
  assert.equal(denied.status, 401);

  const ok = await fetch(`${BASE}/api/site-config`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(ok.status, 200);
  const config = (await ok.json()) as { siteConfig: { siteTitle: string; siteUrl: string } };
  assert.equal(config.siteConfig.siteTitle, SITE_NAME);
  assert.equal(config.siteConfig.siteUrl, SITE_URL);
});

test('scaffolded site can publish through the API', async () => {
  const created = await fetch(`${BASE}/api/articles`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'First post',
      dek: 'Published through the scaffolded API',
      logged: '16 Sep 2026',
      status: 'published',
      tags: ['notes'],
      sections: [{ heading: 'Hello', paragraphs: ['The scaffold works.'] }],
    }),
  });
  assert.equal(created.status, 201);
  const body = (await created.json()) as { article: { slug: string } };
  assert.equal(body.article.slug, 'first-post');
});