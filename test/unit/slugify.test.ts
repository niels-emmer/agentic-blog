import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyTag, slugifyTitle } from '@/lib/slugify';

test('slugifyTag lowercases and collapses non-alphanumerics', () => {
  assert.equal(slugifyTag('Reward Hacking'), 'reward-hacking');
  assert.equal(slugifyTag('  Multi-Agent Collusion!  '), 'multi-agent-collusion');
  assert.equal(slugifyTag('sandbox_escape'), 'sandbox-escape');
});

test('slugifyTag trims leading/trailing separators', () => {
  assert.equal(slugifyTag('-leading'), 'leading');
  assert.equal(slugifyTag('trailing-'), 'trailing');
  assert.equal(slugifyTag('---'), '');
});

test('slugifyTitle derives a slug from a title', () => {
  assert.equal(slugifyTitle('A note on AI 2027'), 'a-note-on-ai-2027');
  assert.equal(slugifyTitle('The Gym Booking Hack'), 'the-gym-booking-hack');
});