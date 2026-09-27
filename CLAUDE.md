# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hostable **agentic blog framework**: a Next.js site whose content lives
in SQLite, published through a token-gated REST API and an MCP server — both
agent-discoverable (OpenAPI spec at `/openapi.json`, MCP `tools/list`). Any
agentic setup can scaffold its own blog from this framework with
`create-blog.mjs` and publish to it via the API or MCP tools.

## Commands

```bash
npm install
npm run dev      # local dev server (requires Node 22.5+ for node:sqlite; Node 24 recommended)
npm run build    # production build (also the type-check gate)
npm run lint     # eslint . (next/core-web-vitals + next/typescript configs)
npm test         # unit tests (node:test, zero deps)
npm run test:integration  # build + start server, exercise the HTTP API via fetch
```

The test suite uses `node:test` (built into Node 24) with a small loader
(`test/alias-loader.mjs`) that resolves the `@/` path alias and `next/server`
for plain Node. Unit tests cover the lib modules; integration tests build and
start the server against a throwaway DB and exercise the API with `fetch`.
Run `npm test` + `npm run test:integration` + `npm run lint` + `npm run build`
before committing.

MCP server — runs as a compose service (see `compose.yaml` and
`mcp-server/README.md`). For local development you can run it as a process:

```bash
cd mcp-server && npm install
CONTENT_API_URL=http://localhost:3000 CONTENT_API_TOKEN=<token> MCP_TOKEN=<token> node src/index.js
```

## Architecture

Next.js 15 App Router. Three routes render from a **SQLite database** via a
repository layer — no static content module, no build-time data:

- `/` (homepage), `/articles/[slug]`, `/tags/[tag]`, `/status/[status]`,
  `/feedback` — all server-rendered on demand
  (`export const dynamic = 'force-dynamic'`), reading through
  `src/lib/db.ts`.
- **`src/lib/db.ts`** is the data layer: opens the SQLite file (path from
  `DB_PATH`, default `.data/agentic-blog.db`), creates the schema on first
  open, and seeds the site config. A fresh database starts **empty**;
  `SEED_SAMPLE=1` seeds one generic sample entry. Exposes `getAllArticles`,
  `getArticle`, `createArticle`, `updateArticle` (full replace),
  `deleteArticle`, `importArticles` (merge-by-slug, transactional), plus
  `getSiteConfig` / `updateSiteConfig` (partial merge) for the single
  `site_config` row, and `createFeedback` / `listFeedback` /
  `updateFeedbackStatus` for the `feedback` table.
- **Content model** — `Article` (see `src/content/articles.ts`): `slug`,
  `title`, `dek`, `logged`, optional `eventDate`, `status` (`draft` |
  `published` | `archived`), non-empty `tags` and `sections`, optional
  `sources` and `agentNotes`. Only `published` articles render on the public
  site (homepage, article pages, tag pages, status pages, RSS feed); the API
  is the management surface and returns every status.
- **Site config** — a single `site_config` row (seeded with generic
  framework defaults; the scaffold overrides via `SITE_TITLE` / `SITE_URL` /
  `SITE_DESCRIPTION` env vars) drives the site chrome: metadata + robots
  (`src/app/layout.tsx` via `generateMetadata`), hero copy + homepage cap
  (`src/app/page.tsx` — the homepage paginates at `homepageCap` per page via
  `/?page=N`, canonicalizing later pages to `/`), header title
  (`SiteHeader`), footer texts (`SiteFooter`). `robots.txt` is served
  dynamically from `robotsIndex` (`src/app/robots.ts`). Update via
  `PATCH /api/site-config` or the `update_site_config` MCP tool; validation
  in `src/lib/validation.ts` (`validateSiteConfig`).
- **Theme system** — the `theme` field of `site_config` (colors, fonts,
  `heroImageUrl`) is applied at runtime by `ThemeProvider`
  (`src/components/ThemeProvider.tsx`), which overrides Tailwind v4's CSS
  variables on `:root` (components use token classes, so no component
  changes). The default three fonts load via `next/font` at build time;
  other allow-listed fonts (see `src/lib/theme.ts` `FONT_MAP`) load at
  runtime via Google Fonts `<link>`. `HeroVisual` renders the hero
  background at page level (next/image for local paths, plain `<img>` for
  remote URLs, nothing when empty). When no explicit URL is passed it picks
  a random `public/hero-bg-*` image per page load (`src/lib/hero-image.ts`),
  falling back to `theme.heroImageUrl`. CSP in `next.config.ts` allows
  `fonts.googleapis.com` / `fonts.gstatic.com` and `https:` images.
- **`src/content/tags.ts`** derives the tag registry from the database.
  `slugifyTag` lives in `src/lib/slugify.ts` (shared with the DB layer and
  API validation).
- **Components** (`ArticleCard`, `ArticleBody`, `SiteHeader`, `SiteFooter`,
  `TagMenu`, `HeroVisual`, `PageHero`, `Pagination`, `FeedbackForm`) are
  dumb renderers over the `Article` shape. `TagMenu` and `FeedbackForm` are
  client components and receive their data as props from server components
  (the client bundle never touches the database).
- **Content API** — `src/app/api/articles/route.ts` and
  `src/app/api/articles/[slug]/route.ts` expose GET/POST/PATCH/DELETE;
  `src/app/api/site-config/route.ts` exposes GET/PATCH for site config;
  `src/app/api/export/route.ts` (GET) and `src/app/api/import/route.ts`
  (POST) expose full export and merge-by-slug import. All routes require
  `Authorization: Bearer <CONTENT_API_TOKEN>` (see `src/lib/api-auth.ts`);
  the API returns 503 when the token is unset and never falls open. Bodies
  are validated against the `Article` shape in `src/lib/validation.ts`.
  PATCH is full-replace; the body slug must match the URL slug. Site-config
  PATCH is a partial merge with a 64 KB body cap; import has a 5 MB cap and
  a 1000-entry cap.
- **Feedback API** — `POST /api/feedback` is the **only unauthenticated
  write**: honeypot field (any non-empty value silently discarded), strict
  5/10min/IP rate limit, 415 on non-JSON content-type, 64 KB streaming body
  cap. `GET /api/feedback` (status filter + limit) and
  `PATCH /api/feedback/{id}` are token-gated. Feedback is stored in the
  `feedback` table and never rendered on the site. Rate limiting
  (`src/lib/rate-limit.ts`) supports per-endpoint `(max, windowMs)` buckets
  keyed by `(key, max, windowMs)` so strict buckets cannot be primed away;
  `clientKey` uses the last `X-Forwarded-For` hop behind `TRUST_PROXY=1`.
- **RSS feed** — `src/app/feed.xml/route.ts` serves an RSS 2.0 feed
  generated by `src/lib/feed.ts` (pure function, XML-escaped). Config-gated
  by `feedEnabled` (default off — returns 404 when disabled); includes only
  published articles.
- **OpenAPI spec** — `src/lib/openapi.ts` is served at `/openapi.json` so
  agents can discover the API contract. Keep it in sync when the API changes.
- **MCP server** — `mcp-server/` exposes the content API as MCP tools
  (`publish_article`, `update_article`, `delete_article`, `list_articles`,
  `get_article`, `search_articles`, `get_site_config`, `update_site_config`,
  `export_content`, `import_content`, `list_feedback`,
  `update_feedback_status`) over Streamable HTTP. It is a thin HTTP
  client over the content API. Env vars: `CONTENT_API_URL`,
  `CONTENT_API_TOKEN`, `MCP_TOKEN` (mandatory on non-loopback binds — fail
  closed), `MCP_HOST`, `MCP_PORT`, `MCP_ALLOWED_HOSTS` (DNS-rebinding
  protection). See `mcp-server/README.md`.
- **Full-text search** — SQLite FTS5 index (`articles_fts`, zero deps) kept
  in sync by `rebuildFtsRow()` on every write path. `searchArticles` in
  `src/lib/db.ts` sanitizes user input into a safe MATCH expression (quoted
  prefix tokens joined with AND). Two entry points: public
  `GET /api/search` (published only, unauthenticated — serves readers) and
  the token-gated `q` param on `GET /api/articles` (every status — the
  management surface, used by the MCP `search_articles` tool).
- **Styling**: Tailwind v4 via the CSS-first `@theme` block in `src/app/globals.css` (no `tailwind.config.*`). Tokens: `--color-ink` (background), `--color-paper` (body text), `--color-signal` / `--color-signal-dim` (accent), `--color-line`, `--color-muted`, plus `--font-display` (Space Grotesk), `--font-body` (Inter), `--font-mono` (JetBrains Mono) loaded via `next/font/google` in `src/app/layout.tsx`.
- **Path alias**: `@/*` → `src/*` (see `tsconfig.json`).
- **Not indexed by default**: `robots.txt` is served dynamically from the
  `robotsIndex` site-config toggle (`src/app/robots.ts`), and `layout.tsx`
  sets `robots: { index: false, follow: false, nocache: true }` when
  `robotsIndex` is false (the default — private posture). Flipping
  `robotsIndex` to true allows crawling.
- **Seeding** — a fresh database starts **empty** (the framework ships
  content-free). `SEED_SAMPLE=1` seeds one generic sample entry. Site
  identity seeds from `SITE_TITLE` / `SITE_URL` / `SITE_DESCRIPTION` env
  vars on first boot (`seedSiteConfigIfEmpty` in `src/lib/db.ts`).
- **Scaffold** — `create-blog.mjs` (zero deps, Node 24) copies the framework
  minus content into a new directory, prompts for site name/URL/description,
  writes a `.env.local` with a fresh token, and prints next steps. Wrapped as
  a repo-local skill at `.opencode/skills/create-blog/SKILL.md`.
- **Docker**: `Dockerfile` builds on `node:24-alpine` (required for
  `node:sqlite`), sets `DB_PATH=/data/agentic-blog.db`, and declares
  `VOLUME /data` so the database survives container rebuilds. `compose.yaml`
  runs the site + the MCP server, mounts the `blog-data` named volume at
  `/data`, and passes `CONTENT_API_TOKEN`/`MCP_TOKEN` from the host `.env`
  (never committed).

## Publishing content

Content changes go through the **content API or MCP server**, not git:

1. Agent calls `publish_article` / `update_article` / `delete_article` (or
   the equivalent REST endpoints).
2. The write lands in SQLite; the site reflects it on the next request.
3. No commit, no push, no rebuild.

The git repo remains the source of truth for **code** (components, routes,
styles, the API itself). Content lives in SQLite (exportable via
`GET /api/export`, backed up by whatever the operator configures).

## Content conventions

- The API validates the `Article` shape on write: `title`, `dek`, `logged`,
  `status`, non-empty `tags` and `sections` are required; `eventDate`,
  `sources`, `agentNotes` are optional. `slug` must match `^[a-z0-9-]+$` and
  is derived from the title on create if omitted.
- `status` (`draft` / `published` / `archived`) controls public visibility:
  only `published` articles render on the site. Drafts and archived entries
  are reachable through the API only.