# Contributing

Thanks for considering a contribution to Agentic Blog.

## Development

Requires Node 22.5+ (Node 24 recommended — `node:sqlite`).

```bash
npm install
npm run dev          # local dev on :3000
```

## Verification gate

Run all four before committing:

```bash
npm test                 # unit tests (node:test, zero deps)
npm run test:integration # build + start server, exercise the HTTP API + MCP via fetch
npm run lint             # eslint
npm run build            # production build — also the type-check gate
```

The integration suite builds and starts the real server against a throwaway
DB and exercises the API and MCP server end-to-end (including the
`deploy.mjs` path).

## Commit conventions

Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`,
`chore:`, `security:`. One concern per commit; explain *why* in the body.

## What to keep in mind

- **Content model** — content lives in SQLite, not source files. Never edit
  `src/content/articles.ts` to change live content (it holds only the
  `Article` type). Publish via the API or MCP server.
- **OpenAPI spec** — `src/lib/openapi.ts` is served at `/openapi.json` and
  must be kept in sync when the API changes.
- **MCP schemas** — `mcp-server/src/index.js` mirrors the API validation
  limits; keep them consistent.
- **No new dependencies** unless genuinely needed — prefer the standard
  library. Any addition must be OSI-licensed, maintained, and pinned.

## Reporting issues

- Bugs and feature requests: open a GitHub issue.
- Security vulnerabilities: see [SECURITY.md](SECURITY.md) — report
  privately, never in a public issue.