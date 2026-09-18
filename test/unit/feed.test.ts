import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFeedXml } from '@/lib/feed';
import type { Article } from '@/content/articles';
import type { SiteConfig } from '@/lib/db';

const config: SiteConfig = {
  siteTitle: 'Test Log',
  siteDescription: 'A test feed',
  siteUrl: 'https://example.com/',
  heroKicker: 'Research log',
  heroTitle: 'Test',
  heroParagraphs: ['p'],
  footerText: 'f',
  footerDisclaimer: 'd',
  robotsIndex: false,
  homepageCap: 25,
  feedEnabled: true,
  theme: {
    colors: { ink: '#000', paper: '#fff', signal: '#0f0', signalDim: '#0a0', line: '#111', muted: '#888' },
    fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    heroImageUrl: '',
  },
  updatedAt: '',
};

const entry: Article = {
  slug: 'test-entry',
  title: 'A <test> & entry',
  dek: 'Dek with "quotes"',
  logged: '4 Sep 2026',
  status: 'published',
  tags: ['oversight'],
  sections: [{ heading: 'What happened', paragraphs: ['Para one & two.', 'Para <two>'] }],
};

test('generateFeedXml produces a well-formed RSS 2.0 document', () => {
  const xml = generateFeedXml([entry], config);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<rss version="2.0"/);
  assert.match(xml, /<channel>/);
  assert.match(xml, /<title>Test Log<\/title>/);
  assert.match(xml, /<link>https:\/\/example.com<\/link>/);
  assert.match(xml, /<item>/);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/example.com\/articles\/test-entry<\/guid>/);
  assert.match(xml, /<pubDate>/);
});

test('generateFeedXml escapes XML-sensitive characters', () => {
  const xml = generateFeedXml([entry], config);
  assert.match(xml, /A &lt;test&gt; &amp; entry/);
  assert.match(xml, /Dek with &quot;quotes&quot;/);
  assert.match(xml, /Para one &amp; two\./);
  assert.match(xml, /Para &lt;two&gt;/);
  // No raw unescaped specials in the title/description/heading/paragraph text.
  assert.doesNotMatch(xml, /<title>A <test>/);
});

test('generateFeedXml omits pubDate when logged is not parseable', () => {
  const weird = { ...entry, slug: 'weird', logged: 'not-a-date' };
  const xml = generateFeedXml([weird], config);
  assert.doesNotMatch(xml, /<pubDate>/);
});

test('generateFeedXml strips trailing slash from siteUrl', () => {
  const xml = generateFeedXml([entry], { ...config, siteUrl: 'https://example.com' });
  assert.match(xml, /<link>https:\/\/example.com<\/link>/);
  assert.match(xml, /https:\/\/example.com\/articles\/test-entry/);
});

test('generateFeedXml strips XML-forbidden control characters', () => {
  const dirty = {
    ...entry,
    slug: 'dirty',
    title: 'Bad\u0000title',
    sections: [{ heading: 'H\u0007eading', paragraphs: ['Para\u001Fgraph'] }],
  };
  const xml = generateFeedXml([dirty], config);
  assert.doesNotMatch(xml, /\u0000|\u0007|\u001F/);
  assert.match(xml, /Badtitle/);
  assert.match(xml, /Heading/);
  assert.match(xml, /Paragraph/);
});