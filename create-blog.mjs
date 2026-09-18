#!/usr/bin/env node
/**
 * create-blog — scaffold a new blog/site from this framework, minus content.
 *
 * Copies the repo (excluding this site's data, git history, build artifacts,
 * and session docs), prompts for the site's identity, writes a .env.local
 * with a freshly generated content-API token, and prints next steps.
 *
 * Usage:
 *   node create-blog.mjs <target-dir> [--name "Site name"] [--url https://...]
 *       [--description "One-liner"] [--sample]
 *
 * With no flags the script prompts interactively. --sample seeds one generic
 * sample entry (SEED_SAMPLE=1). Zero dependencies — Node 24 only.
 */
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

// Path segments never copied into a scaffold: this site's data/history and
// session artifacts. Content is deliberately excluded — the framework ships
// content-free (a fresh database starts empty). Matched on ANY path segment
// so nested node_modules/.env files (e.g. mcp-server/node_modules) are
// excluded too. .env.example is a committed placeholder and is copied.
const EXCLUDED_SEGMENTS = ['.git', '.data', '.next', 'node_modules', '.env', '.env.local'];

function shouldExclude(src) {
  const rel = path.relative(REPO_ROOT, src);
  const segments = rel.split(path.sep);
  return segments.some((segment) => EXCLUDED_SEGMENTS.includes(segment));
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

async function prompt(rl, question, fallback) {
  const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
  return answer || fallback;
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const target = positional[0];
  if (!target) {
    console.error('Usage: node create-blog.mjs <target-dir> [--name ...] [--url ...] [--description ...] [--sample]');
    process.exit(1);
  }
  const targetResolved = path.resolve(target);
  if (targetResolved === REPO_ROOT || targetResolved.startsWith(REPO_ROOT + path.sep)) {
    console.error('Target must be outside the framework repo');
    process.exit(1);
  }
  if (existsSync(target)) {
    console.error(`Target directory already exists: ${target}`);
    process.exit(1);
  }

  let name = flags.name;
  let url = flags.url;
  let description = flags.description;
  const sample = flags.sample === true || flags.sample === '1';

  if (!name || !url || !description) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      name = await prompt(rl, 'Site name', name);
      url = await prompt(rl, 'Site URL (https://...)', url);
      description = await prompt(rl, 'One-line description', description);
    } finally {
      rl.close();
    }
  }

  // Reject control characters (would corrupt .env.local) and validate the URL.
  const hasControl = (v) => /[\r\n\u0000-\u001F]/.test(v);
  if (hasControl(name) || hasControl(url) || hasControl(description)) {
    console.error('Site name, URL, and description must not contain control characters');
    process.exit(1);
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }
  if (!parsedUrl || (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')) {
    console.error(`Site URL must be an http(s) URL (got "${url}")`);
    process.exit(1);
  }

  console.log(`\nScaffolding into ${target} ...`);
  cpSync(REPO_ROOT, target, {
    recursive: true,
    filter: (src) => !shouldExclude(src),
  });

  const token = randomBytes(32).toString('hex');
  const envLines = [
    `CONTENT_API_TOKEN=${token}`,
    `SITE_TITLE=${name}`,
    `SITE_URL=${url}`,
    `SITE_DESCRIPTION=${description}`,
  ];
  if (sample) envLines.push('SEED_SAMPLE=1');
  writeFileSync(path.join(target, '.env.local'), envLines.join('\n') + '\n', { mode: 0o600 });

  console.log('Done.\n');
  console.log('Next steps:');
  console.log(`  cd ${target}`);
  console.log('  npm install');
  console.log('  npm run dev        # local site on http://localhost:3000');
  console.log('  npm run build && npm start   # production');
  console.log('');
  console.log('The site title, URL, and description are seeded into SQLite on first boot');
  console.log('from .env.local. Content starts empty (or with one sample entry if you used');
  console.log('--sample). Publish entries via the content API or the MCP server — see API.md.');
  console.log('');
  console.log('Exposing the site:');
  console.log('  - npm: remove "private": true from package.json, then npm publish, and');
  console.log('    deploy the package anywhere Node 24 runs (the DB lives in .data/).');
  console.log('  - proxy server: run the site on :3000 and front it with nginx, Caddy, or');
  console.log('    a Cloudflare tunnel. The MCP server (mcp-server/) can be exposed the');
  console.log('    same way — it is token-gated and fails closed on non-loopback binds.');
  console.log('');
  console.log(`Your content API token (keep it secret — it is also in ${target}/.env.local):`);
  console.log(`  ${token}`);
}

main().catch((error) => {
  console.error('Scaffold failed:', error);
  process.exit(1);
});