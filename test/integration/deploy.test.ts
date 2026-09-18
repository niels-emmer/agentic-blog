import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * End-to-end deploy test: scaffold a site, symlink node_modules (no network),
 * run deploy.mjs with --skip-install, and verify the connection card, the
 * running site, the API, and the MCP server (including a tools/list call).
 */

const REPO = path.resolve(import.meta.dirname, '..', '..');
const PORT = 3196;
const MCP_PORT = 3457;
const BASE = `http://localhost:${PORT}`;

const tempRoot = mkdtempSync(path.join(tmpdir(), 'agentic-blog-deploy-'));
const siteDir = path.join(tempRoot, 'site');

const SITE_NAME = 'Deploy Test Blog';
const SITE_URL = 'https://deploy-test.example';
const SITE_DESC = 'A blog created by the deploy test';

let deploy: ChildProcess;
let deployOutput = '';
let apiToken = '';
let mcpToken = '';
let sitePid = 0;
let mcpPid = 0;

function run(cmd: string, args: string[], opts: { cwd: string; timeout?: number }) {
  return execFileSync(cmd, args, {
    cwd: opts.cwd,
    timeout: opts.timeout ?? 180_000,
    stdio: 'pipe',
    env: { ...process.env, NVM_DIR: process.env.NVM_DIR ?? '' },
  });
}

function waitForCard(timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (deployOutput.includes('=== Agentic Blog deployed ===')) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`deploy did not print the connection card. Output so far:\n${deployOutput}`));
      }
    }, 500);
  });
}

before(async () => {
  // 1. Scaffold the site (create-blog.mjs).
  run(
    process.execPath,
    ['create-blog.mjs', siteDir, '--name', SITE_NAME, '--url', SITE_URL, '--description', SITE_DESC],
    { cwd: REPO },
  );

  // 2. Reuse the source repo's node_modules (no network in tests).
  symlinkSync(path.join(REPO, 'node_modules'), path.join(siteDir, 'node_modules'), 'dir');
  symlinkSync(path.join(REPO, 'mcp-server', 'node_modules'), path.join(siteDir, 'mcp-server', 'node_modules'), 'dir');

  // 3. Run deploy.mjs (skip install — node_modules are symlinked).
  deploy = spawn(
    process.execPath,
    [
      'deploy.mjs', siteDir,
      '--name', SITE_NAME, '--url', SITE_URL, '--description', SITE_DESC,
      '--skip-install', '--port', String(PORT), '--mcp-port', String(MCP_PORT),
    ],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  deploy.stdout.on('data', (d) => {
    deployOutput += d.toString();
  });
  deploy.stderr.on('data', (d) => {
    deployOutput += d.toString();
  });

  await waitForCard();

  // 4. Parse the connection card.
  const apiMatch = deployOutput.match(/API token: ([0-9a-f]{64})/);
  const mcpMatch = deployOutput.match(/MCP token: ([0-9a-f]{64})/);
  const sitePidMatch = deployOutput.match(/Site PID:\s+(\d+)/);
  const mcpPidMatch = deployOutput.match(/MCP PID:\s+(\d+)/);
  assert.ok(apiMatch, 'connection card must include the API token');
  assert.ok(mcpMatch, 'connection card must include the MCP token');
  assert.ok(sitePidMatch, 'connection card must include the site PID');
  assert.ok(mcpPidMatch, 'connection card must include the MCP PID');
  apiToken = apiMatch[1];
  mcpToken = mcpMatch[1];
  sitePid = Number(sitePidMatch[1]);
  mcpPid = Number(mcpPidMatch[1]);
});

after(() => {
  // deploy.mjs exits after printing the card (detach mode) — the servers
  // keep running in the background, so stop them by PID.
  for (const pid of [sitePid, mcpPid]) {
    if (pid > 0) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }
  deploy?.kill();
  rmSync(tempRoot, { recursive: true, force: true });
});

test('deployed site serves its identity', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, new RegExp(SITE_NAME));
});

test('deployed API answers with the scaffolded token', async () => {
  const res = await fetch(`${BASE}/api/articles`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { articles: unknown[] };
  assert.ok(Array.isArray(body.articles));
});

test('deployed OpenAPI spec is served', async () => {
  const res = await fetch(`${BASE}/openapi.json`);
  assert.equal(res.status, 200);
});

async function mcpRequest(method: string, params?: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${MCP_PORT}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${mcpToken}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // notification responses may have an empty body
  }
  return { status: res.status, body };
}

test('deployed MCP server is token-gated (401 without token)', async () => {
  const res = await fetch(`http://127.0.0.1:${MCP_PORT}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(res.status, 401);
});

test('deployed MCP server answers tools/list with the MCP token', async () => {
  const init = await mcpRequest('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'deploy-test', version: '0.0.1' },
  });
  assert.equal(init.status, 200, `initialize failed: ${JSON.stringify(init.body)}`);
  await mcpRequest('notifications/initialized');

  const list = await mcpRequest('tools/list');
  assert.equal(list.status, 200, `tools/list failed: ${JSON.stringify(list.body)}`);
  const result = list.body as { result?: { tools?: { name: string }[] } } | null;
  const names = result?.result?.tools?.map((t) => t.name) ?? [];
  assert.ok(names.includes('publish_article'), 'tools/list must include publish_article');
  assert.ok(names.includes('update_site_config'));
});