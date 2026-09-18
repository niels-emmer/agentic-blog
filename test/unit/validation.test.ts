import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArticle, validateSiteConfig, validateThemePatch } from '@/lib/validation';

const validInput = {
  title: 'A test article',
  dek: 'A short dek',
  logged: '2026-09-01',
  status: 'published',
  tags: ['reward hacking'],
  sections: [{ heading: 'What happened', paragraphs: ['A paragraph.'] }],
};

test('accepts a valid article and derives a slug from the title', () => {
  const result = validateArticle(validInput, { requireSlug: false });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.slug, 'a-test-article');
    assert.equal(result.value.title, 'A test article');
  }
});

test('accepts an explicit slug when provided', () => {
  const result = validateArticle({ ...validInput, slug: 'my-explicit-slug' }, { requireSlug: false });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.slug, 'my-explicit-slug');
});

test('rejects a non-object body', () => {
  for (const bad of [null, 'string', 42, [], undefined]) {
    const result = validateArticle(bad, { requireSlug: false });
    assert.equal(result.ok, false);
  }
});

test('rejects invalid slugs', () => {
  const result = validateArticle({ ...validInput, slug: 'Bad Slug!' }, { requireSlug: false });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('slug')));
});

test('rejects slugs longer than 100 characters', () => {
  const result = validateArticle(
    { ...validInput, slug: 'a'.repeat(101) },
    { requireSlug: false },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('100')));
});

test('requireSlug mode rejects a missing slug', () => {
  const result = validateArticle(validInput, { requireSlug: true });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('slug')));
});

test('rejects missing required fields', () => {
  const result = validateArticle({ ...validInput, title: '' }, { requireSlug: false });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('title')));
});

test('rejects invalid status', () => {
  const result = validateArticle({ ...validInput, status: 'not-a-status' }, { requireSlug: false });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('status')));
});

test('rejects empty tags array', () => {
  const result = validateArticle({ ...validInput, tags: [] }, { requireSlug: false });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('tags')));
});

test('rejects non-http(s) source URLs (blocks javascript:, data:)', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://example.com']) {
    const result = validateArticle(
      { ...validInput, sources: [{ label: 'x', url }] },
      { requireSlug: false },
    );
    assert.equal(result.ok, false, `should reject ${url}`);
    if (!result.ok) assert.ok(result.errors.some((e) => e.includes('http(s)')));
  }
});

test('accepts http and https source URLs', () => {
  const result = validateArticle(
    { ...validInput, sources: [{ label: 'Example', url: 'https://example.com/a?b=1' }] },
    { requireSlug: false },
  );
  assert.equal(result.ok, true);
});

test('enforces size limits', () => {
  const tooLong = validateArticle({ ...validInput, title: 'x'.repeat(201) }, { requireSlug: false });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.ok(tooLong.errors.some((e) => e.includes('200')));

  const tooManyTags = validateArticle(
    { ...validInput, tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`) },
    { requireSlug: false },
  );
  assert.equal(tooManyTags.ok, false);

  const tooManySections = validateArticle(
    { ...validInput, sections: Array.from({ length: 51 }, () => ({ heading: 'h', paragraphs: ['p'] })) },
    { requireSlug: false },
  );
  assert.equal(tooManySections.ok, false);
});

test('trims strings on success', () => {
  const result = validateArticle(
    { ...validInput, title: '  Padded title  ', tags: ['  spaced tag  '] },
    { requireSlug: false },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.title, 'Padded title');
    assert.equal(result.value.tags[0], 'spaced tag');
  }
});

// ---------------------------------------------------------------------------
// Site config validation
// ---------------------------------------------------------------------------

test('validateSiteConfig accepts a partial patch', () => {
  const result = validateSiteConfig({ heroTitle: 'New title', homepageCap: 10 });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.heroTitle, 'New title');
    assert.equal(result.value.homepageCap, 10);
    assert.equal(result.value.siteTitle, undefined, 'untouched fields are absent from the patch');
  }
});

test('validateSiteConfig rejects unknown fields', () => {
  const result = validateSiteConfig({ bogusField: 'x' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('unknown field')));
});

test('validateSiteConfig rejects a non-object body', () => {
  for (const bad of [null, 'x', 42, []]) {
    assert.equal(validateSiteConfig(bad).ok, false);
  }
});

test('validateSiteConfig rejects bad siteUrl schemes', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://x']) {
    const result = validateSiteConfig({ siteUrl: url });
    assert.equal(result.ok, false, `should reject ${url}`);
  }
  assert.equal(validateSiteConfig({ siteUrl: 'https://example.com' }).ok, true);
});

test('validateSiteConfig rejects invalid robotsIndex and homepageCap', () => {
  assert.equal(validateSiteConfig({ robotsIndex: 'yes' }).ok, false);
  assert.equal(validateSiteConfig({ homepageCap: 0 }).ok, false);
  assert.equal(validateSiteConfig({ homepageCap: 101 }).ok, false);
  assert.equal(validateSiteConfig({ homepageCap: 2.5 }).ok, false);
  assert.equal(validateSiteConfig({ homepageCap: 25 }).ok, true);
});

test('validateSiteConfig enforces string limits', () => {
  assert.equal(validateSiteConfig({ siteTitle: 'x'.repeat(201) }).ok, false);
  assert.equal(validateSiteConfig({ siteDescription: 'x'.repeat(501) }).ok, false);
  assert.equal(validateSiteConfig({ heroParagraphs: ['x'.repeat(2001)] }).ok, false);
  assert.equal(validateSiteConfig({ heroParagraphs: Array.from({ length: 11 }, () => 'p') }).ok, false);
  assert.equal(validateSiteConfig({ heroParagraphs: [] }).ok, false);
});

// ---------------------------------------------------------------------------
// Theme validation
// ---------------------------------------------------------------------------

test('validateThemePatch accepts a partial theme patch', () => {
  const result = validateThemePatch({ colors: { ink: '#000000' }, fonts: { display: 'Georgia' } });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.colors?.ink, '#000000');
    assert.equal(result.value.fonts?.display, 'Georgia');
    assert.equal(result.value.heroImageUrl, undefined);
  }
});

test('validateThemePatch rejects invalid hex colors', () => {
  for (const bad of ['red', '#12345', '#1234567', 'rgb(0,0,0)', '']) {
    const result = validateThemePatch({ colors: { ink: bad } });
    assert.equal(result.ok, false, `should reject ${bad}`);
  }
  assert.equal(validateThemePatch({ colors: { ink: '#ABC' } }).ok, true, '3-digit hex allowed');
  assert.equal(validateThemePatch({ colors: { ink: '#aabbcc' } }).ok, true);
});

test('validateThemePatch rejects fonts outside the allow-list', () => {
  const result = validateThemePatch({ fonts: { body: 'Comic Sans MS' } });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('must be one of')));
  assert.equal(validateThemePatch({ fonts: { body: 'Roboto' } }).ok, true);
});

test('validateThemePatch rejects unknown theme fields and roles', () => {
  assert.equal(validateThemePatch({ bogus: 1 }).ok, false);
  assert.equal(validateThemePatch({ colors: { neon: '#000000' } }).ok, false);
  assert.equal(validateThemePatch({ fonts: { fancy: 'Georgia' } }).ok, false);
});

test('validateThemePatch validates heroImageUrl', () => {
  assert.equal(validateThemePatch({ heroImageUrl: '/hero.jpg' }).ok, true);
  assert.equal(validateThemePatch({ heroImageUrl: 'https://example.com/bg.jpg' }).ok, true);
  assert.equal(validateThemePatch({ heroImageUrl: 'javascript:alert(1)' }).ok, false);
  assert.equal(validateThemePatch({ heroImageUrl: '//evil.com/bg.jpg' }).ok, false);
  assert.equal(validateThemePatch({ heroImageUrl: 'https:/evil.com/bg.jpg' }).ok, false);
  assert.equal(validateThemePatch({ heroImageUrl: 'data:text/html,<script>' }).ok, false);
});

test('validateSiteConfig accepts a theme patch and rejects a bad one', () => {
  const ok = validateSiteConfig({ theme: { colors: { signal: '#ff0000' } } });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.theme?.colors?.signal, '#ff0000');

  const bad = validateSiteConfig({ theme: { fonts: { mono: 'Wingdings' } } });
  assert.equal(bad.ok, false);
});