# AGENTS.md

A self-hostable **agentic blog framework**: a Next.js site whose content lives
in SQLite, published through a token-gated REST API and an MCP server — both
agent-discoverable. See [CLAUDE.md](CLAUDE.md) for full architecture.

## Commands

Requires Node 22.5+ (`node:sqlite`); Node 24 recommended (native TS stripping).

```bash
npm install
npm run dev          # local dev on :3000
npm run build        # production build — also the type-check gate
npm run lint         # eslint . (next/core-web-vitals + next/typescript)
npm test             # unit tests (node:test, zero deps)
npm run test:integration  # build + start server, exercise the HTTP API via fetch
```

Run `npm test` + `npm run test:integration` + `npm run lint` + `npm run build`
before committing. Tests use `test/alias-loader.mjs` (resolves `@/` → `src/`
and `next/server` for plain Node); integration tests build and start the
server against a throwaway DB (`DB_PATH` env) and hit the API with `fetch`.

MCP server (local dev):

```bash
cd mcp-server && npm install
CONTENT_API_URL=http://localhost:3000 CONTENT_API_TOKEN=<token> MCP_TOKEN=<token> node src/index.js
# smoke test: node test-client.js http://127.0.0.1:3456/mcp <MCP_TOKEN>
```

## Content model — SQLite, not git

Content lives in a **SQLite database**, not source files. The site renders
dynamically from it, so publishing is immediate — **no git push, no rebuild**
for content changes. Publish/edit/delete via the content API or the MCP server
(preferred for agents); never edit source files to change live content.

- **Agent discoverability** — the framework is built to be found by agents:
  OpenAPI spec at `/openapi.json` (source `src/lib/openapi.ts` — **keep in
  sync when the API changes**), `API.md`, and MCP `tools/list` (no manual tool
  registration).
- **API** → `API.md`. All routes require `Authorization: Bearer
  $CONTENT_API_TOKEN`; the API returns 503 when the token is unset and never
  falls open.
- **MCP server** (`mcp-server/`) → thin HTTP client over the content API:
  `publish_article`, `update_article`, `delete_article`, `list_articles`,
  `get_article`, `get_site_config`, `update_site_config`, `export_content`,
  `import_content`. See `mcp-server/README.md`.
- **Article shape** → `src/content/articles.ts` (types only). `status` is
  `draft` | `published` | `archived`; only `published` articles render on the
  public site (homepage, article pages, tag pages, RSS feed) — the API is the
  management surface and returns every status.
- **Site config** → single `site_config` row drives chrome (title, hero,
  footer, robots toggle, homepage cap, feed toggle) + runtime theme (colors,
  fonts, `heroImageUrl`). Update via `PATCH /api/site-config` or
  `update_site_config`. `robotsIndex` defaults false (private posture);
  `feedEnabled` defaults off (`/feed.xml` 404s).
- **Export/import** → `GET /api/export` / `POST /api/import` (merge-by-slug
  upsert, transactional, never deletes unless `deleteMissing: true`).
- **Fresh DB starts empty**; `SEED_SAMPLE=1` seeds one generic sample entry.
  Site identity seeds from `SITE_TITLE` / `SITE_URL` / `SITE_DESCRIPTION` env
  vars on first boot (`seedSiteConfigIfEmpty` in `src/lib/db.ts`).
- **Local DB** → `.data/agentic-blog.db` (gitignored); `DB_PATH` env
  overrides. Docker runs it on the `/data` volume.

## Scaffolding a new site

`node create-blog.mjs <target-dir> [--name ...] [--url ...] [--description ...] [--sample]`
copies the framework minus content/history/secrets into a new dir, writes a
fresh `.env.local` with a generated token, and prints next steps. Wrapped as
`.opencode/skills/create-blog/SKILL.md`. The scaffolded site is a full
framework copy (config, theme, RSS, export/import, tests all work).

## Deploying a site (agent-operable)

`node deploy.mjs <target-dir> --name ... --url ... --description ... [--port 3000] [--mcp-port 3456] [--skip-install] [--sample]`
scaffolds (or reuses) a site, installs deps, builds, starts the site + MCP
server, and prints a machine-parseable connection card (site URL, API token,
MCP endpoint + token). Foreground process manager — Ctrl+C stops both
servers. This is the one-command path for an agent that receives the repo URL
and must stand up a connected blog.