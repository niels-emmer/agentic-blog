import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Fresh process, no SEED_SAMPLE: a new database must start EMPTY (the
// framework ships content-free; SEED_SAMPLE=1 is the only opt-in sample).
const tempDir = mkdtempSync(path.join(tmpdir(), 'agentic-blog-seed-empty-'));
process.env.DB_PATH = path.join(tempDir, 'empty.db');
delete process.env.SEED_SAMPLE;

const db = await import('@/lib/db');

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test('a fresh database is empty by default (no SEED_SAMPLE)', () => {
  assert.equal(db.getAllArticles().length, 0);
});

test('site config still seeds with defaults on an empty database', () => {
  const config = db.getSiteConfig();
  assert.equal(config.siteTitle, 'Agentic Blog');
  assert.equal(config.homepageCap, 25);
  assert.equal(config.feedEnabled, false);
});