import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { requireApiAuth } from '@/lib/api-auth';

const TOKEN = 'test-token-123';

beforeEach(() => {
  process.env.CONTENT_API_TOKEN = TOKEN;
});

test('returns 503 when CONTENT_API_TOKEN is unset (never falls open)', () => {
  delete process.env.CONTENT_API_TOKEN;
  const response = requireApiAuth(new Request('http://localhost/api/x'));
  assert.equal(response?.status, 503);
});

test('returns 401 for a missing Authorization header', () => {
  const response = requireApiAuth(new Request('http://localhost/api/x'));
  assert.equal(response?.status, 401);
});

test('returns 401 for a wrong token', () => {
  const request = new Request('http://localhost/api/x', {
    headers: { authorization: 'Bearer wrong-token' },
  });
  const response = requireApiAuth(request);
  assert.equal(response?.status, 401);
});

test('returns 401 for a malformed Authorization header', () => {
  const request = new Request('http://localhost/api/x', {
    headers: { authorization: 'Basic abc123' },
  });
  const response = requireApiAuth(request);
  assert.equal(response?.status, 401);
});

test('returns null (passes) for the correct bearer token', () => {
  const request = new Request('http://localhost/api/x', {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(requireApiAuth(request), null);
});