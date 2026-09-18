import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity } from '../../deploy.mjs';

const ENV_KEYS = ['SITE_TITLE', 'SITE_URL', 'SITE_DESCRIPTION'];

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  try {
    for (const key of ENV_KEYS) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('resolveIdentity falls back to generic defaults when nothing is set', () => {
  withEnv({}, () => {
    assert.deepEqual(resolveIdentity({}), {
      name: 'My Blog',
      url: 'http://localhost:3000',
      description: 'A blog created with the Agentic Blog framework',
    });
  });
});

test('resolveIdentity prefers SITE_* env vars over defaults', () => {
  withEnv(
    { SITE_TITLE: 'Env Blog', SITE_URL: 'https://env.example', SITE_DESCRIPTION: 'From env' },
    () => {
      assert.deepEqual(resolveIdentity({}), {
        name: 'Env Blog',
        url: 'https://env.example',
        description: 'From env',
      });
    },
  );
});

test('resolveIdentity prefers explicit flags over env vars', () => {
  withEnv(
    { SITE_TITLE: 'Env Blog', SITE_URL: 'https://env.example', SITE_DESCRIPTION: 'From env' },
    () => {
      assert.deepEqual(
        resolveIdentity({ name: 'Flag Blog', url: 'https://flag.example', description: 'From flags' }),
        { name: 'Flag Blog', url: 'https://flag.example', description: 'From flags' },
      );
    },
  );
});

test('resolveIdentity mixes flags and env vars per-field', () => {
  withEnv({ SITE_TITLE: 'Env Blog', SITE_URL: 'https://env.example' }, () => {
    assert.deepEqual(resolveIdentity({ name: 'Flag Blog' }), {
      name: 'Flag Blog',
      url: 'https://env.example',
      description: 'A blog created with the Agentic Blog framework',
    });
  });
});