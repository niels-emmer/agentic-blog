#!/usr/bin/env node
/**
 * deploy — scaffold (or reuse), build, and run an Agentic Blog site with its
 * MCP server, then print a connection card an agent can parse.
 *
 * Usage (all arguments optional):
 *   node deploy.mjs [target-dir] [--name "Site name"] [--url https://...]
 *       [--description "One-liner"] [--port 3000] [--mcp-port 3456]
 *       [--skip-install] [--sample] [--foreground]
 *
 * Identity resolution: --name/--url/--description flags, else the
 * SITE_TITLE/SITE_URL/SITE_DESCRIPTION env vars, else generic defaults.
 * target-dir defaults to ./agentic-blog-site.
 *
 * By default deploy.mjs EXITS after printing the connection card — the site
 * and MCP servers keep running in the background (their output goes to
 * <target>/site.log and <target>/mcp.log; stop them with the printed kill
 * command). This is what lets an agent run deploy as a background task and
 * get a completion notification. Pass --foreground to keep the servers
 * attached to the terminal instead (Ctrl+C stops both).
 *
 * Steps: scaffold via create-blog.mjs (or reuse an existing scaffold) →
 * npm install (site + mcp-server, unless --skip-install) → build → start the
 * site → start the MCP server → wait for readiness → print connection
 * details.
 *
 * Zero dependencies — Node 24 only.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const DEFAULT_TARGET = 'agentic-blog-site';

const DEFAULT_IDENTITY = {
  name: 'My Blog',
  url: 'http://localhost:3000',
  description: 'A blog created with the Agentic Blog framework',
};

/**
 * Resolve the site identity: explicit flags win, then SITE_TITLE/SITE_URL/
 * SITE_DESCRIPTION env vars (the same vars the site seeds from), then
 * generic defaults. This is what lets an agent deploy with zero arguments.
 */
export function resolveIdentity(flags) {
  return {
    name: flags.name ?? process.env.SITE_TITLE ?? DEFAULT_IDENTITY.name,
    url: flags.url ?? process.env.SITE_URL ?? DEFAULT_IDENTITY.url,
    description: flags.description ?? process.env.SITE_DESCRIPTION ?? DEFAULT_IDENTITY.description,
  };
}

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

function waitForFileLine(filePath, needle, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      try {
        if (readFileSync(filePath, 'utf8').includes(needle)) {
          clearInterval(timer);
          resolve(true);
          return;
        }
      } catch {
        // log file may not exist yet
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 300);
  });
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const target = positional[0] ?? DEFAULT_TARGET;
  const targetResolved = path.resolve(target);
  const { name, url, description } = resolveIdentity(flags);
  const port = Number(flags.port ?? 3000);
  const mcpPort = Number(flags['mcp-port'] ?? 3456);
  const skipInstall = flags['skip-install'] === true || flags['skip-install'] === '1';
  const sample = flags.sample === true || flags.sample === '1';
  const foreground = flags.foreground === true || flags.foreground === '1';

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

  // 4. Start the site (output → <target>/site.log).
  const siteLog = path.join(targetResolved, 'site.log');
  const siteOut = openSync(siteLog, 'a');
  console.log(`Starting site on http://localhost:${port} ...`);
  let siteExited = false;
  const site = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
    cwd: targetResolved,
    env: { ...process.env, CONTENT_API_TOKEN: apiToken },
    stdio: ['ignore', siteOut, siteOut],
  });
  site.on('exit', () => {
    siteExited = true;
  });

  // 5. Start the MCP server (output → <target>/mcp.log).
  const mcpLog = path.join(targetResolved, 'mcp.log');
  const mcpOut = openSync(mcpLog, 'a');
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
    stdio: ['ignore', mcpOut, mcpOut],
  });

  // 6. Wait for readiness.
  const siteUp = await waitForHttp(`http://localhost:${port}`, 60_000, () => siteExited);
  if (!siteUp) {
    console.error(`Site did not become ready on port ${port}. Is the port in use?`);
    site.kill();
    mcp.kill();
    process.exit(1);
  }
  const mcpUp = await waitForFileLine(mcpLog, 'listening');
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
  console.log(`Site PID:  ${site.pid}`);
  console.log(`MCP PID:   ${mcp.pid}`);
  console.log(`Logs:      ${siteLog}, ${mcpLog}`);
  console.log('');
  console.log('Connect your MCP client to the MCP URL with the MCP token — tools are');
  console.log('auto-discovered via tools/list (publish_article, update_site_config, ...).');
  console.log('Site identity is configured from SITE_TITLE/SITE_URL/SITE_DESCRIPTION (or');
  console.log('--name/--url/--description); theme and content are managed through the API');
  console.log('or MCP tools.');

  if (foreground) {
    // Foreground mode: keep the servers attached; Ctrl+C stops both.
    console.log('Foreground mode: Ctrl+C stops both servers.');
    const cleanup = () => {
      console.log('\nStopping servers ...');
      site.kill();
      mcp.kill();
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    await new Promise(() => {});
  } else {
    // Detach (default): exit cleanly — the servers keep running in the
    // background, writing to their log files. This lets an agent run deploy
    // as a background task and receive a completion notification.
    console.log('Servers run in the background. Stop them with:');
    console.log(`  kill ${site.pid} ${mcp.pid}`);
    process.exit(0);
  }
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Deploy failed:', error);
    process.exit(1);
  });
}