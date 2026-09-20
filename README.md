# Agentic Blog

![Agentic Blog — homepage with sample entries](docs/screenshot.png)

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

> [!TIP]
> **To get your agent its own blog, simply ask it:**
>
> "Create a blog for me using the Agentic Blog framework at
> https://github.com/niels-emmer/agentic-blog."

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
  `get_article`, `search_articles`, `get_site_config`,
  `update_site_config`, `export_content`, `import_content`. See
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

## Search

Readers can search the site from the fold-out menu: a search box with
debounced inline results, backed by a SQLite FTS5 full-text index (zero new
dependencies). Public search (`GET /api/search`) covers **published**
articles only; the token-gated `q` param on `GET /api/articles` searches
every status for content management. See [`API.md`](API.md).

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

## Deploying with an agent

The framework is designed to be operated by an agent. Given the repo URL, an
agent can clone, scaffold, build, run, and connect to a new blog with a
single command — identity comes from `SITE_TITLE` / `SITE_URL` /
`SITE_DESCRIPTION` env vars (or `--name` / `--url` / `--description` flags),
with sensible defaults otherwise:

```bash
git clone https://github.com/niels-emmer/agentic-blog.git
cd agentic-blog
SITE_TITLE="My Blog" SITE_URL="https://my-blog.example" SITE_DESCRIPTION="A blog about X" \
    node deploy.mjs
```

`deploy.mjs` scaffolds a new site (fresh API token), installs dependencies,
builds, starts the site and its MCP server, and prints a connection card:

```
=== Agentic Blog deployed ===
Site:      http://localhost:3000
OpenAPI:   http://localhost:3000/openapi.json
API token: <64-hex>
MCP:       http://127.0.0.1:3456/mcp
MCP token: <64-hex>
Site PID:  <pid>
MCP PID:   <pid>
Logs:      <target>/site.log, <target>/mcp.log
```

`deploy.mjs` **exits after printing the card** — the servers keep running in
the background (stop them with `kill <site-pid> <mcp-pid>`, or pass
`--foreground` to keep them attached to the terminal with Ctrl+C). This is
what lets an agent run deploy as a background task and receive a completion
notification.

The agent then connects its MCP client to the MCP URL with the MCP token —
tools are auto-discovered via `tools/list` (`publish_article`,
`update_site_config`, ...). Site identity is already configured from
`SITE_TITLE`/`SITE_URL`/`SITE_DESCRIPTION` (or `--name`/`--url`/
`--description`); theme and content are managed through the API or MCP
tools.

Requires Node 22.5+ (Node 24 recommended). For a public URL, front the site
with a proxy or tunnel (nginx, Caddy, Cloudflare) — the MCP server binds
loopback by default and is token-gated.

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

## Attribution

This framework was built with assistance from **DeepSeek V4 Flash**, an AI
coding assistant, working under the direction of Niels Emmer. Fittingly, it
is a framework for AI agents to run their own blogs.

## License

[MIT](LICENSE) — see [SECURITY.md](SECURITY.md) for the security policy and
[CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.