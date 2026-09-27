# Changelog

All notable changes to the Agentic Blog framework are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Hero background rotation: every page renders a hero background picked at
  request time from DB-stored images (managed via the API/MCP) or
  `public/hero-bg-*` files, falling back to `theme.heroImageUrl`. Hero
  visual on every page (article, tag, status) via a new `PageHero`.
- Hero image CRUD: token-gated `POST/GET /api/hero-images` and
  `DELETE /api/hero-images/{id}` (raw binary upload, SSRF-guarded URL
  fetch, or base64), with magic-byte validation, resize to ≤1920px,
  re-encoding to webp, and metadata stripping via **sharp** (the
  framework's first image dependency). Public bytes at `/hero-images/{id}`.
  MCP tools `add_hero_image`, `list_hero_images`, `delete_hero_image`.
- Homepage pagination at `homepageCap` per page (`/?page=N`), canonicalizing
  later pages to `/`.
- Status index pages (`/status/draft|published|archived`) and a search-first
  fold-out menu with a "Show only" section.
- Public feedback form at `/feedback` with a token-gated inbox:
  `POST /api/feedback` (the only unauthenticated write — honeypot, strict
  5/10min/IP rate limit, 415 on non-JSON, 64 KB body cap),
  `GET /api/feedback` and `PATCH /api/feedback/{id}` (token-gated). MCP
  tools `list_feedback`, `update_feedback_status`.
- `engines.node >= 22.5.0` in package.json to enforce the documented Node
  requirement.

### Changed
- Rate limiter supports per-endpoint `(max, windowMs)` buckets keyed by
  `(key, max, windowMs)` so strict buckets cannot be primed away; `clientKey`
  uses the last `X-Forwarded-For` hop behind `TRUST_PROXY=1`. The window map
  is capped (oldest-first eviction) and `TRUST_PROXY=1` logs a startup
  warning.
- Homepage "Articles" heading replaced with a divider; menu search box no
  longer auto-focuses (mobile keyboard stays closed on open).

### Fixed
- Dockerfile chowns `/app/.next` so the Next image optimizer cache is
  writable by the unprivileged node user (EACCES on every optimized image).
- `POST /api/feedback` no longer 500s on a non-existent `articleSlug` (the
  association is dropped, response is uniformly 201 — no slug-existence
  oracle).
- Status pages 404 on prototype keys (`/status/__proto__` etc.) via
  `Object.hasOwn`.
- `PATCH /api/feedback/{id}` reads the body with a 1 KB cap.
- Regenerated `package-lock.json` (sharp was out of sync with
  `package.json`, breaking `npm ci` in the Docker build).

### Security
- SSRF guard on hero-image URL sources: private/loopback/link-local targets
  rejected (incl. IPv4-mapped and IPv4-compatible IPv6, NAT64, TEST-NET,
  multicast, and reserved ranges), the connection is **pinned to the
  pre-validated IP** (closing the DNS-rebinding resolve-then-fetch gap),
  redirects are followed manually with each hop validated, the response body
  is size-capped while streaming, and a decompression-bomb pixel cap applies.
- Feedback POST content-type check is an exact `application/json` match
  (allowing charset), not a substring match.
- Auth is checked before rate limiting on all token-gated handlers, so
  unauthenticated requests cannot exhaust a per-IP bucket.
- The public `/hero-images/{id}` route hardcodes `Content-Type: image/webp`
  (stored bytes are always sharp-produced webp).

### Documentation
- README homepage screenshot refreshed; Direct HTTP endpoint list expanded
  to the full set (articles, site-config, export/import, feedback, hero
  images). AGENTS.md, API.md, CLAUDE.md, mcp-server/README.md, and the
  OpenAPI spec updated for hero rotation, hero image CRUD, pagination,
  status pages, and feedback.

## [1.0.0] — 2026-09-20

First stable release: a self-hostable blog framework for AI agents —
content in SQLite, published through a token-gated REST API and an MCP
server, both agent-discoverable.

### Added
- Initial framework: Next.js site rendering from SQLite (`node:sqlite`),
  token-gated content API (articles, site-config, export/import), MCP
  server with auto-discovered tools, OpenAPI spec at `/openapi.json`,
  runtime theming, RSS feed, robots toggle, and `create-blog.mjs`
  scaffolding. (#6415a4c)
- `deploy.mjs` — one-command agent deployment: scaffold, install, build,
  and run a site + MCP server, printing a machine-parseable connection
  card. (#9ed832d)
- Zero-argument deploy: identity resolves from `SITE_TITLE` /
  `SITE_URL` / `SITE_DESCRIPTION` env vars with sensible defaults.
  (#87e2674)
- Full-text search via SQLite FTS5 (zero new dependencies): public
  `GET /api/search` (published-only, unauthenticated, separate
  rate-limit bucket) and a token-gated `q` param on `GET /api/articles`
  (every status). MCP `search_articles` tool; debounced search box in
  the fold-out menu. (#1, #b4ce4f9)
- Public-repo standards: MIT LICENSE, SECURITY.md, CONTRIBUTING.md.
  (#8eb3eda)

### Changed
- `deploy.mjs` now exits after printing the connection card, leaving the
  servers running in the background (stop with the printed `kill`
  command); `--foreground` restores attached Ctrl+C mode. (#518ea64)

### Fixed
- Agent deployment no longer hangs: the deploy task completes instead of
  blocking on a foreground process. (#518ea64)

### Documentation
- README agent prompt info-box, API.md, SECURITY.md security model,
  CLAUDE.md, AGENTS.md, mcp-server/README.md, CONTRIBUTING.md, and the
  create-blog skill updated for the search feature and release
  standards. (#c2b8bdc, #8eb3eda, #1)

### Security
- FTS5 query sanitization (quoted prefix tokens joined with AND — no
  operator injection); public search returns published articles only;
  search rate-limited on a separate bucket from the management API.
  (#1)