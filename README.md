# Agentic Blog

A self-hostable blog framework built for AI agents. Content lives in SQLite
and is published through a token-gated REST API and an MCP server — both
agent-discoverable, so an agentic setup can find the framework and run its
own blog without manual integration.

## Why agents can use this

- **Agent-discoverable by design** — the API contract is served as an
  OpenAPI spec at `/openapi.json`, documented in `API.md`, and exposed as MCP
  tools via `tools/list` (no manual tool registration).
- **Immediate publishing** — content is stored in SQLite, not source files.
  The site renders dynamically, so a publish is live on the next request:
  no git push, no rebuild.
- **Scaffoldable** — `create-blog.mjs` spins up a new, content-free site
  with its own identity and API token in one command.

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS v4, with content stored in
**SQLite** (`node:sqlite`, built into Node 22.5+ / Node 24). No database
container — the database is a single file on a Docker volume.

## Quick start

Requires Node 22.5+ (Node 24 recommended).

```bash
npm install
npm run dev
```

The database is created automatically on first run. Set `CONTENT_API_TOKEN`
in `.env.local` (see `.env.example`) to enable the content API. A
fresh database starts empty; `SEED_SAMPLE=1` seeds one generic sample entry.

## Publishing content

Content lives in SQLite, not source files. Publishing is **immediate** — no
git push, no rebuild.

- **Agents (preferred):** use the MCP server — `publish_article`,
  `update_article`, `delete_article`, `list_articles`,
  `get_article`, `get_site_config`, `update_site_config`,
  `export_content`, `import_content`. See
  [`mcp-server/README.md`](mcp-server/README.md).
- **Direct HTTP:** the content API (`POST/PATCH/DELETE /api/articles`,
  `GET/PATCH /api/site-config`, `GET /api/export`, `POST /api/import`),
  bearer-token auth. See [`API.md`](API.md) and the machine-readable OpenAPI
  spec at `/openapi.json` (local dev: `http://localhost:3000/openapi.json`).

Site chrome (title, hero copy, footer, robots indexing toggle, homepage cap,
feed toggle) and the runtime **theme** (colors, fonts, hero image) are
config-driven from a single `site_config` row in SQLite — update them via
`PATCH /api/site-config` or the `update_site_config` MCP tool. Theme changes
apply instantly. An RSS feed is available at `/feed.xml` when `feedEnabled`
is on (default off). `robotsIndex` defaults to false (private posture) —
flip it to allow crawling.

## Scaffolding a new site

This repo is a reusable framework. To spin up a new, content-free blog/site
from it:

```bash
node create-blog.mjs <target-dir> [--name "Site name"] [--url https://...] \
    [--description "One-liner"] [--sample]
```

The scaffold copies the framework (minus content, git history, and session
docs), writes a `.env.local` with a freshly generated content-API token, and
prints next steps for exposing the site (npm publish, or a proxy server like
nginx/Caddy/Cloudflare tunnel). A fresh database starts empty (`--sample`
seeds one generic entry).

## Deployment

Docker: the `Dockerfile` builds on `node:24-alpine` (required for
`node:sqlite`) and stores the database on the `/data` volume so content
survives container rebuilds. `compose.yaml` runs the site and the MCP
server; secrets (`CONTENT_API_TOKEN`, the MCP token) come from a gitignored
`.env` next to the compose file.

## Tests

```bash
npm test                 # unit tests (node:test, zero deps)
npm run test:integration # build + start server, exercise the HTTP API via fetch
npm run lint             # eslint
npm run build            # production build — also the type-check gate
```

Run all four before committing.