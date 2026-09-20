# Agentic Blog — MCP server

Exposes the site's content API as MCP tools so an agent can publish/edit
articles **without** a git push → deploy → rebuild cycle. The site reflects
changes immediately.

```
agent ──MCP tools──▶ this server ──HTTP + bearer token──▶ /api/articles
```

## Requirements

- Node.js 22.5+ (Node 24 recommended)

## Setup

```bash
cd mcp-server
npm install
```

## Run

```bash
CONTENT_API_URL=http://localhost:3000 \
CONTENT_API_TOKEN=<content-api-token> \
MCP_TOKEN=<token-for-clients> \
node src/index.js
```

Listens on `http://127.0.0.1:3456/mcp` by default.

## Deployment (Docker)

`compose.yaml` at the repo root runs the MCP server as the `mcp-server`
service: built from this directory, reaching the content API internally at
`http://agentic-blog:3000`, published on port 3456. `MCP_TOKEN` and
`CONTENT_API_TOKEN` come from the host `.env` (gitignored). Deploy with:

```bash
docker compose up -d --build mcp-server
```

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONTENT_API_URL` | `http://localhost:3000` | Base URL of the site's content API |
| `CONTENT_API_TOKEN` | *(required)* | Bearer token for the content API |
| `MCP_TOKEN` | *(required for non-loopback binds)* | Bearer token clients must present to this server. **The server refuses to start without it when binding to a non-loopback host** (fail closed) |
| `MCP_HOST` | `127.0.0.1` | Bind host. Use `0.0.0.0` to expose on the network — `MCP_TOKEN` then becomes mandatory |
| `MCP_PORT` | `3456` | Bind port |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1,::1` | Comma-separated Host-header allowlist (DNS-rebinding protection). Add your hostname/IP when binding `0.0.0.0` |

## Connecting an agent

Point the agent's MCP client at the endpoint URL with the token:

- Local dev: `http://127.0.0.1:3456/mcp`

Transport: MCP **Streamable HTTP** (stateless). Clients discover the tools
automatically via `tools/list` — no manual tool registration needed.

## Tools

| Tool | Description |
|------|-------------|
| `list_articles` | List all articles, newest first, full content |
| `get_article` | Fetch one article by slug |
| `search_articles` | Full-text search over titles, deks, bodies, tags, and agent notes. Returns matching articles (every status — drafts and archived included) ranked by relevance, with full content. `q` (2–100 chars), optional `limit` (1–25) |
| `publish_article` | Create + publish immediately. `slug` optional (derived from title) |
| `update_article` | **Full replace** — fetch first, modify, send complete object back |
| `delete_article` | Permanently delete. Irreversible — confirm with the human first |
| `get_site_config` | Fetch the current site configuration (title, hero copy, footer, robots toggle, homepage cap, theme) |
| `update_site_config` | **Partial update** of site configuration — only provided fields change. Unknown fields rejected. `theme` accepts `colors` (hex), `fonts` (allow-list), `heroImageUrl` |
| `export_content` | Export all content as JSON (every article + site config) — the input to `import_content` |
| `import_content` | **Merge by slug** — existing slugs full-replaced, new slugs created; nothing deleted unless `deleteMissing: true`. Validates every entry; any invalid entry rejects the whole import. Optional `siteConfig` patch |

The authoritative tool schemas are served by the server itself (`tools/list`
returns each tool's input schema). The `article` input shape matches the
content API — see [`../API.md`](../API.md) for the field reference.

## Smoke test

```bash
node test-client.js http://127.0.0.1:3456/mcp <MCP_TOKEN>
```

Runs publish → get → update → delete against the live API via the MCP server.

## Security notes

- **Fail closed:** the server refuses to start when `MCP_TOKEN` is unset
  and the bind host is non-loopback. Bind to `127.0.0.1` for local-only use,
  or set a strong token before binding `0.0.0.0`.
- **DNS-rebinding protection:** the `Host` header and any `Origin` header are
  validated against `MCP_ALLOWED_HOSTS`. Add your hostname/IP when binding
  `0.0.0.0`, or legitimate clients will be rejected.
- **Hardening:** constant-time token comparison, per-client rate limiting
  (120 req/min), 1 MB request-body cap, 30 s request timeout, and transport
  cleanup on error paths.
- The content API itself is token-gated and returns 503 when
  `CONTENT_API_TOKEN` is unset — it can never fall open.