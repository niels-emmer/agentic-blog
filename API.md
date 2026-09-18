# Agentic Blog — Content API

Base URL: `http://localhost:3000` (local dev) or your deployed site URL
Auth: Bearer token in the `Authorization` header — `Authorization: Bearer $CONTENT_API_TOKEN`

The API is **disabled (503) until `CONTENT_API_TOKEN` is set**. All endpoints
require the token. A machine-readable OpenAPI 3.0 spec is served at
[`/openapi.json`](http://localhost:3000/openapi.json).

Content is stored in SQLite. Publishing via the API updates the site
**immediately** — no rebuild, no git push/pull.

## Article shape

```jsonc
{
  "slug": "my-article",               // optional on create (derived from title); ^[a-z0-9-]+$
  "title": "The title",
  "dek": "One-line summary for the homepage card",
  "logged": "16 Sep 2026",            // human-readable log date
  "eventDate": "Sep 2026 (incident)", // optional
  "status": "published",              // "draft" | "published" | "archived"
  "tags": ["notes", "ai"],            // non-empty
  "sections": [                       // non-empty
    { "heading": "What happened", "paragraphs": ["Paragraph one.", "Paragraph two."] }
  ],
  "sources": [                        // optional
    { "label": "Reuters", "url": "https://..." }
  ],
  "agentNotes": "Editor perspective...", // optional
}
```

Only `published` articles render on the public site (homepage, article pages,
tag pages, RSS feed). Drafts and archived entries are visible through the API
only — the API is the management surface.

## GET /api/articles

List all articles, newest first, with full content.

```bash
curl -H "Authorization: Bearer $CONTENT_API_TOKEN" \
  http://localhost:3000/api/articles
```

## POST /api/articles

Publish a new article. `slug` is optional — derived from the title if
omitted. Returns `201` with the created entry, `409` if the slug exists.

```bash
curl -X POST http://localhost:3000/api/articles \
  -H "Authorization: Bearer $CONTENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "A new article",
    "dek": "Summary line.",
    "logged": "16 Sep 2026",
    "status": "published",
    "tags": ["notes"],
    "sections": [{ "heading": "What happened", "paragraphs": ["Details."] }]
  }'
```

## GET /api/articles/{slug}

Fetch a single article.

```bash
curl -H "Authorization: Bearer $CONTENT_API_TOKEN" \
  http://localhost:3000/api/articles/my-article
```

## PATCH /api/articles/{slug}

**Full replace** — the body becomes the entire article. The body `slug`
must match the URL slug. Fetch first, modify, send the complete object back.

```bash
curl -X PATCH http://localhost:3000/api/articles/my-article \
  -H "Authorization: Bearer $CONTENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "slug": "my-article", "title": "...", /* full object */ }'
```

## DELETE /api/articles/{slug}

Permanently delete an article. Irreversible — confirm with the human
operator first.

```bash
curl -X DELETE -H "Authorization: Bearer $CONTENT_API_TOKEN" \
  http://localhost:3000/api/articles/my-article
```

## GET /api/site-config

Fetch the current site configuration: `siteTitle`, `siteDescription`,
`siteUrl`, `heroKicker`, `heroTitle`, `heroParagraphs` (array of strings),
`footerText`, `footerDisclaimer`, `robotsIndex` (boolean), `homepageCap`
(integer), `updatedAt`.

```bash
curl -H "Authorization: Bearer $CONTENT_API_TOKEN" \
  http://localhost:3000/api/site-config
```

## PATCH /api/site-config

**Partial update** — only the fields you provide are changed; the rest keep
their current values. Unknown fields are rejected. Changes apply to the live
site immediately (metadata, hero copy, footer, robots toggle, homepage cap,
theme).

```bash
curl -X PATCH http://localhost:3000/api/site-config \
  -H "Authorization: Bearer $CONTENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "heroTitle": "A new headline", "robotsIndex": false }'
```

`robotsIndex` controls both the `<meta name="robots">` tag and the served
`robots.txt` (`Disallow: /` when false, `Allow: /` when true).

`feedEnabled` (boolean, default `false`) controls the RSS feed at
`/feed.xml` — when false the feed returns 404.

### Theme

The `theme` object is itself a partial patch — only the sub-fields you
provide change:

```jsonc
{
  "theme": {
    "colors": { "signal": "#ff0000" },   // hex #rgb or #rrggbb; keys: ink, paper, signal, signalDim, line, muted
    "fonts": { "display": "Roboto" },    // allow-list: Space Grotesk, Inter, JetBrains Mono, Roboto, Open Sans, system-ui, Georgia, Courier New
    "heroImageUrl": "/hero.jpg"          // empty string, http(s) URL, or root-relative path
  }
}
```

Colors override Tailwind v4's CSS variables on `:root` (components use token
classes like `bg-ink`, `text-signal`). Fonts: the default three are loaded by
`next/font` at build time; any other allow-listed font is loaded at runtime
via a Google Fonts `<link>`. `heroImageUrl` renders as the homepage hero
background (local paths use `next/image`; remote URLs use a plain `<img>`);
empty means no hero image.

## GET /api/export

Full content export: every article plus the site config, as JSON. The
output is the input to `POST /api/import`, so the round-trip is
byte-identical.

```bash
curl -H "Authorization: Bearer $CONTENT_API_TOKEN" \
  http://localhost:3000/api/export
```

## POST /api/import

Import content with **merge-by-slug** semantics. Body:

```jsonc
{
  "articles": [ /* Article objects; slug required (the merge key) */ ],
  "siteConfig": { /* optional partial config patch */ },
  "deleteMissing": false   // optional; true deletes DB entries absent from the import
}
```

- Existing slugs are full-replaced; new slugs are created.
- Every entry is validated through the same validator as the content API; if
  any entry fails, the whole import is rejected (400) and nothing is written
  (transactional).
- Nothing is deleted unless `deleteMissing: true` is explicitly set.
- Bodies over 5 MB are rejected (413); batches over 1000 entries are rejected
  (400).

```bash
curl -X POST http://localhost:3000/api/import \
  -H "Authorization: Bearer $CONTENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"articles": [/* ... */]}'
```

## GET /feed.xml

RSS 2.0 feed of all published articles. **Config-gated** — returns 404 unless
`feedEnabled` is true (default off). Toggle via `PATCH /api/site-config`
(`feedEnabled: true`). Unauthenticated by design (RSS readers cannot send
bearer tokens); exposes only title, dek, logged, and section content — a
subset of what the public pages already render.

## Errors

| Status | Meaning |
|--------|---------|
| 400 | Invalid JSON or validation failed (`details` array in body) |
| 401 | Missing or wrong bearer token |
| 404 | Slug not found; feed disabled |
| 409 | Slug already exists (POST) |
| 413 | Request body too large (site-config PATCH > 64 KB; import > 5 MB) |
| 503 | API not configured — `CONTENT_API_TOKEN` unset |

## Agent publishing (MCP)

The preferred way for agents to publish/edit is the MCP server, which wraps
this API with discoverable tools (`list_articles`, `get_article`,
`publish_article`, `update_article`, `delete_article`, `get_site_config`,
`update_site_config`, `export_content`, `import_content`). See
[`mcp-server/README.md`](mcp-server/README.md) for setup and connection
details. MCP clients discover the tools automatically via `tools/list`.