---
name: create-blog
description: Scaffold a new blog/site from the Agentic Blog framework minus content. Copies the repo, prompts for site name/URL/description, writes a .env.local with a generated content-API token, and prints next steps for exposing the site (npm or a proxy server). USE FOR: scaffold a new site, create a blog, spin up a blank blog, new site from framework, create-blog. DO NOT USE FOR: editing the current site's content (use the MCP server or content API).
---

# create-blog

Scaffold a new, content-free blog/site from this framework. The result is a
blank site that looks like this one by default (same theme/layout) but has
its own identity, its own content-API token, and no content.

## When to use

- Starting a new blog/site that should reuse this framework (site config,
  runtime theming, RSS, export/import, MCP publishing).
- You want a blank site "minus content" — not a copy of this site's entries.

## Usage

```bash
node create-blog.mjs <target-dir> [--name "Site name"] [--url https://...] \
    [--description "One-liner"] [--sample]
```

- `<target-dir>` — where the new site is created (must not exist).
- `--name` / `--url` / `--description` — skip the interactive prompts.
- `--sample` — seed one generic sample entry (`SEED_SAMPLE=1`); default is an
  empty site.

## What it does

1. Copies the repo, excluding this site's data (`.data/`), git history
   (`.git/`), build artifacts (`.next/`, `node_modules/`), and session docs
   (`docs/PLAN.md`, `docs/decision-log.md`).
2. Generates a 64-hex content-API token (`crypto.randomBytes(32)`).
3. Writes `.env.local` with `CONTENT_API_TOKEN` plus `SITE_TITLE`,
   `SITE_URL`, `SITE_DESCRIPTION` — the site config seeds from these on first
   boot (see `seedSiteConfigIfEmpty` in `src/lib/db.ts`).
4. Prints next steps: run locally, publish via npm (remove `"private": true`
   first), or expose via a proxy server (nginx/Caddy/Cloudflare tunnel).

## After scaffolding

- `cd <target> && npm install && npm run dev`
- Publish entries via the content API (`POST /api/articles`) or the MCP
  server (`mcp-server/`) — see `API.md` and `mcp-server/README.md`.
- The scaffolded site is a full framework copy: site config, theme, RSS,
  export/import, and tests all work out of the box.

## Notes

- The scaffold never copies secrets: any `.env` / `.env.local` file (at any
  depth) and this site's `.data/` database are excluded, and the token is
  generated fresh for the new site. `.env.example` (a committed
  placeholder) is copied.
- The framework ships content-free: `src/content/articles.ts` holds only the
  `Article` type, and a fresh database starts empty.