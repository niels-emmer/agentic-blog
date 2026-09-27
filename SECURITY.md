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
  the token is unset** and never falls open. The exceptions are
  `GET /api/search` (unauthenticated by design — it serves site readers and
  returns only published articles with fields the public pages already
  render; drafts and archived entries are never exposed) and
  `POST /api/feedback` (the only unauthenticated **write** — protected by a
  honeypot field, a strict 5/10min/IP rate limit, a 415 gate on non-JSON
  content types, and a 64 KB streaming body cap; feedback is stored in
  SQLite and never rendered on the site).
- **MCP server** — token-gated (`MCP_TOKEN`), **fails closed** on
  non-loopback binds (refuses to start without a token), and validates
  `Host`/`Origin` headers against `MCP_ALLOWED_HOSTS` (DNS-rebinding
  protection).
- **SQL** — all database access uses parameterized statements
  (`node:sqlite` prepared statements); no user input is concatenated into
  SQL. Full-text search queries are sanitized into a safe FTS5 MATCH
  expression (quoted prefix tokens joined with AND) so FTS5 operators in
  user input are neutralized, never executed.
- **Input validation** — every write path validates its input: the `Article`
  shape (size caps, slug regex, http(s)-only URL allow-lists, theme color
  hex + font allow-list), feedback submissions (message/name/email/slug
  caps, unknown-field rejection), and hero images (magic-byte validation —
  the Content-Type header is never trusted — plus resize to ≤1920px,
  re-encoding to webp, and metadata stripping via sharp). Request bodies are
  size-capped **while streaming** (not trusting `Content-Length`).
- **Hero image URL sources** — SSRF-guarded: only http(s), private/loopback/
  link-local targets rejected (incl. IPv4-mapped IPv6), redirects followed
  manually with each hop validated, 10 MB source cap, decompression-bomb
  pixel cap.
- **Rate limiting** — per-client fixed-window limiter on the API and MCP
  server, with per-endpoint `(max, windowMs)` buckets keyed by
  `(key, max, windowMs)` so a strict endpoint's bucket (e.g. feedback
  submissions: 5/10min/IP) can never be primed away by a laxer one.
  `X-Forwarded-For` is only trusted when `TRUST_PROXY=1` is set, and then
  only the **last** hop (the proxy-appended real client address) is used.
  `GET /api/search` is rate-limited on a **separate bucket** so reader
  traffic can never exhaust the management API's quota.
- **Privacy posture** — `robotsIndex` defaults to false (noindex), the RSS
  feed defaults off, public search returns published articles only, and
  feedback submissions are never rendered on the site.
- **Docker** — runs as the unprivileged `node` user; the database lives on a
  volume; the image-optimizer cache under `/app/.next` is chowned to that
  user; `.dockerignore` excludes env files and local data.

## Supported versions

The project is pre-1.0. Only the latest commit on `main` is supported;
security fixes land there and are backported only on request.

## Scope

The following are **out of scope** (operator responsibilities):

- TLS termination (use a reverse proxy — nginx, Caddy, Cloudflare).
- Exposing the MCP server beyond loopback without setting a strong
  `MCP_TOKEN` and a correct `MCP_ALLOWED_HOSTS`.
- Weak operator-chosen `CONTENT_API_TOKEN` values.