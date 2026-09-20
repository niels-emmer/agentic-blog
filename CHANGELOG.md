# Changelog

All notable changes to the Agentic Blog framework are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Nothing yet.

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