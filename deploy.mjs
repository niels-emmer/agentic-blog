#!/usr/bin/env node
/**
 * deploy — scaffold (or reuse), build, and run an Agentic Blog site with its
 * MCP server, then print a connection card an agent can parse.
 *
 * Usage:
 *   node deploy.mjs <target-dir> --name "Site name" --url https://... \
 *       --description "One-liner" [--port 3000] [--mcp-port 3456] \
 *       [--skip-install] [--sample]
 *
 * Steps: scaffold via create-blog.mjs (or reuse an existing scaffold) →
 * npm install (site + mcp-server, unless --skip-install) → build → start the
 * site → start the MCP server → wait for readiness → print connection
 * details. Foreground process manager: Ctrl+C stops both servers.
 *
 * Zero dependencies — Node 24 only.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args.flags[key] = next;
        i += 1;
      } else {
        args.flags[key] = true;
      }
    } else {
      args.positional.push(arg);
    }
  }
  return args;
}

function run(cmd, args, opts) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    console.error(`Command failed (exit ${result.status}): ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
}

async function waitForHttp(url, timeoutMs = 60_000, isDead = () => false) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isDead()) return false;
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function waitForLine(stream, needle, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    let buffer = '';
    const timer = setTimeout(() => {
      stream.off('data', onData);
      resolve(false);
    }, timeoutMs);
    function onData(chunk) {
      buffer += chunk.toString();
      if (buffer.includes(needle)) {
        clearTimeout(timer);
        stream.off('data', onData);
        resolve(true);
      }
    }
    stream.on('data', onData);
  });
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const target = positional[0];
  if (!target) {
    console.error(
      'Usage: node deploy.mjs <target-dir> --name "Site name" --url https://... --description "One-liner" [--port 3000] [--mcp-port 3456] [--skip-install] [--sample]',
    );
    process.exit(1);
  }
  const targetResolved = path.resolve(target);
  const name = flags.name;
  const url = flags.url;
  const description = flags.description;
  const port = Number(flags.port ?? 3000);
  const mcpPort = Number(flags['mcp-port'] ?? 3456);
  const skipInstall = flags['skip-install'] === true || flags['skip-install'] === '1';
  const sample = flags.sample === true || flags.sample === '1';

  if (!name || !url || !description) {
    console.error('--name, --url, and --description are required (deploy is non-interactive).');
    process.exit(1);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`--port must be an integer between 1 and 65535 (got "${flags.port}").`);
    process.exit(1);
  }
  if (!Number.isInteger(mcpPort) || mcpPort < 1 || mcpPort > 65535) {
    console.error(`--mcp-port must be an integer between 1 and 65535 (got "${flags['mcp-port']}").`);
    process.exit(1);
  }

  // 1. Scaffold (or reuse an existing scaffolded site).
  const isExistingSite = existsSync(path.join(targetResolved, 'package.json'));
  if (isExistingSite) {
    console.log(`Reusing existing site at ${targetResolved}`);
  } else {
    console.log(`Scaffolding new site into ${targetResolved} ...`);
    const scaffoldArgs = ['create-blog.mjs', target, '--name', name, '--url', url, '--description', description];
    if (sample) scaffoldArgs.push('--sample');
    const scaffold = spawnSync(process.execPath, scaffoldArgs, { cwd: REPO_ROOT, stdio: 'pipe' });
    if (scaffold.status !== 0) {
      process.stdout.write(scaffold.stdout);
      process.stderr.write(scaffold.stderr);
      console.error('Scaffold failed.');
      process.exit(1);
    }
  }

  // Read the content-API token from the scaffolded .env.local.
  const envLocalPath = path.join(targetResolved, '.env.local');
  if (!existsSync(envLocalPath)) {
    console.error(`Missing ${envLocalPath} — expected a scaffolded site.`);
    process.exit(1);
  }
  const envLocal = readFileSync(envLocalPath, 'utf8');
  const tokenMatch = envLocal.match(/^CONTENT_API_TOKEN=(.+)$/m);
  if (!tokenMatch) {
    console.error('CONTENT_API_TOKEN not found in .env.local');
    process.exit(1);
  }
  const apiToken = tokenMatch[1];

  // 2. Install dependencies (site + mcp-server) unless --skip-install.
  if (!skipInstall) {
    console.log('Installing site dependencies ...');
    run('npm', ['install'], { cwd: targetResolved });
    console.log('Installing MCP server dependencies ...');
    run('npm', ['install'], { cwd: path.join(targetResolved, 'mcp-server') });
  } else {
    if (!existsSync(path.join(targetResolved, 'node_modules'))) {
      console.warn('Warning: --skip-install but node_modules is missing — the build will likely fail.');
    }
    console.log('Skipping npm install (--skip-install)');
  }

  // 3. Build.
  console.log('Building ...');
  run('npm', ['run', 'build'], { cwd: targetResolved });

  // 4. Start the site.
  console.log(`Starting site on http://localhost:${port} ...`);
  let siteExited = false;
  const site = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
    cwd: targetResolved,
    env: { ...process.env, CONTENT_API_TOKEN: apiToken },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  site.stdout.on('data', (d) => process.stdout.write(d));
  site.stderr.on('data', (d) => process.stderr.write(d));
  site.on('exit', () => {
    siteExited = true;
  });

  // 5. Start the MCP server.
  const mcpToken = randomBytes(32).toString('hex');
  console.log(`Starting MCP server on http://127.0.0.1:${mcpPort}/mcp ...`);
  const mcp = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(targetResolved, 'mcp-server'),
    env: {
      ...process.env,
      CONTENT_API_URL: `http://localhost:${port}`,
      CONTENT_API_TOKEN: apiToken,
      MCP_TOKEN: mcpToken,
      MCP_HOST: '127.0.0.1',
      MCP_PORT: String(mcpPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  mcp.stdout.on('data', (d) => process.stdout.write(d));
  mcp.stderr.on('data', (d) => process.stderr.write(d));

  // Attach the readiness listener immediately — the MCP server can print its
  // "listening" line before the site-readiness poll below finishes, and a
  // late-attached listener would miss it.
  const mcpReady = waitForLine(mcp.stdout, 'listening');

  // 6. Wait for readiness.
  const siteUp = await waitForHttp(`http://localhost:${port}`, 60_000, () => siteExited);
  if (!siteUp) {
    console.error(`Site did not become ready on port ${port}. Is the port in use?`);
    site.kill();
    mcp.kill();
    process.exit(1);
  }
  const mcpUp = await mcpReady;
  if (!mcpUp) {
    console.error('MCP server did not become ready.');
    site.kill();
    mcp.kill();
    process.exit(1);
  }

  // 7. Connection card.
  console.log('');
  console.log('=== Agentic Blog deployed ===');
  console.log(`Site:      http://localhost:${port}`);
  console.log(`OpenAPI:   http://localhost:${port}/openapi.json`);
  console.log(`API token: ${apiToken}`);
  console.log(`MCP:       http://127.0.0.1:${mcpPort}/mcp`);
  console.log(`MCP token: ${mcpToken}`);
  console.log('');
  console.log('Connect your MCP client to the MCP URL with the MCP token — tools are');
  console.log('auto-discovered via tools/list (publish_article, update_site_config, ...).');
  console.log('Site identity is configured from --name/--url/--description; theme and');
  console.log('content are managed through the API or MCP tools. Ctrl+C stops both servers.');

  // 8. Cleanup on exit.
  const cleanup = () => {
    console.log('\nStopping servers ...');
    site.kill();
    mcp.kill();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep the process alive (foreground process manager).
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('Deploy failed:', error);
  process.exit(1);
});