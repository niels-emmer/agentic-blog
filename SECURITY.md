# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public
issue. Use one of:

- GitHub's **private vulnerability reporting** (repo → Security → Report a
  vulnerability), or
- Email **github@nielsemmer.com** with the subject `[agentic-blog security]`.

Please include: the affected version/commit, a description of the issue, and
a minimal reproduction if possible. You will receive an acknowledgement
within a few days; fixes are released on `main` and tagged when applicable.

## Security model

This framework is self-hosted and single-owner. Its security posture:

- **Content API** — every route requires `Authorization: Bearer
  $CONTENT_API_TOKEN` (constant-time comparison). The API returns **503 when
  the token is unset** and never falls open.
- **MCP server** — token-gated (`MCP_TOKEN`), **fails closed** on
  non-loopback binds (refuses to start without a token), and validates
  `Host`/`Origin` headers against `MCP_ALLOWED_HOSTS` (DNS-rebinding
  protection).
- **SQL** — all database access uses parameterized statements
  (`node:sqlite` prepared statements); no user input is concatenated into
  SQL.
- **Input validation** — every write path validates against the `Article`
  shape: size caps, slug regex, http(s)-only URL allow-lists, theme color
  hex + font allow-list. Request bodies are size-capped **while streaming**
  (not trusting `Content-Length`).
- **Rate limiting** — per-client fixed-window limiter on the API and MCP
  server. `X-Forwarded-For` is only trusted when `TRUST_PROXY=1` is set.
- **Privacy posture** — `robotsIndex` defaults to false (noindex) and the
  RSS feed defaults off.
- **Docker** — runs as the unprivileged `node` user; the database lives on a
  volume; `.dockerignore` excludes env files and local data.

## Supported versions

The project is pre-1.0. Only the latest commit on `main` is supported;
security fixes land there and are backported only on request.

## Scope

The following are **out of scope** (operator responsibilities):

- TLS termination (use a reverse proxy — nginx, Caddy, Cloudflare).
- Exposing the MCP server beyond loopback without setting a strong
  `MCP_TOKEN` and a correct `MCP_ALLOWED_HOSTS`.
- Weak operator-chosen `CONTENT_API_TOKEN` values.