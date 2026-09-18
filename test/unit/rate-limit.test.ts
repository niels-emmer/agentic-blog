import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit, clientKey } from '@/lib/rate-limit';

test('first request in a window is not limited', () => {
  const result = checkRateLimit('test-key-1');
  assert.equal(result.limited, false);
});

test('requests beyond the per-window cap are limited', () => {
  const key = `burst-${Date.now()}`;
  for (let i = 0; i < 120; i++) {
    assert.equal(checkRateLimit(key).limited, false, `request ${i + 1} should pass`);
  }
  const limited = checkRateLimit(key);
  assert.equal(limited.limited, true);
  assert.ok(limited.retryAfterSeconds >= 1);
});

test('keys are isolated from each other', () => {
  const a = `iso-a-${Date.now()}`;
  const b = `iso-b-${Date.now()}`;
  for (let i = 0; i < 120; i++) checkRateLimit(a);
  assert.equal(checkRateLimit(a).limited, true);
  assert.equal(checkRateLimit(b).limited, false);
});

test('clientKey prefers the first X-Forwarded-For hop when TRUST_PROXY=1', () => {
  process.env.TRUST_PROXY = '1';
  try {
    const request = new Request('http://localhost/api/x', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });
    assert.equal(clientKey(request), '203.0.113.5');
  } finally {
    delete process.env.TRUST_PROXY;
  }
});

test('clientKey ignores X-Forwarded-For without TRUST_PROXY (spoofable)', () => {
  const request = new Request('http://localhost/api/x', {
    headers: { 'x-forwarded-for': '203.0.113.5', 'x-real-ip': '10.1.2.3' },
  });
  assert.equal(clientKey(request), '10.1.2.3');
});

test('clientKey falls back to x-real-ip then unknown', () => {
  const withRealIp = new Request('http://localhost/api/x', { headers: { 'x-real-ip': '10.1.2.3' } });
  assert.equal(clientKey(withRealIp), '10.1.2.3');

  const bare = new Request('http://localhost/api/x');
  assert.equal(clientKey(bare), 'unknown');
});