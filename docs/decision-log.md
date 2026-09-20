# Decision Log

Architecture and workflow decisions for the Agentic Blog framework. Each entry
records what was decided, why, and the alternatives considered.

---

## AB-001 — Full-text search via SQLite FTS5

**Date:** 2026-09-20
**Status:** Accepted
**AI-authored:** yes

### Context

The site needed a search facility: a search box in the fold-out menu drawer
with debounced inline results, backed by a full-text index.

### Decision

Use **SQLite FTS5** — a virtual table (`articles_fts`) in the existing
database, zero new dependencies. One FTS row per article: `slug UNINDEXED`
(join key only) plus denormalized `title`, `dek`, `body` (headings +
paragraphs concatenated), `tags`, and `agent_notes`. The index is kept in
sync by `rebuildFtsRow()`, called at the end of `insertChildren()` — the
single choke point every create/update path funnels through — plus explicit
deletes in `deleteArticle()` and the `deleteMissing` branch of
`importArticles()`. A one-time `backfillFtsIfEmpty()` in `migrate()` covers
databases that predate the feature.

User input is sanitized into a safe MATCH expression (quoted prefix tokens
joined with AND) so FTS5 operators (`OR`, `-`, `"`, `*`) can never inject or
throw a syntax error.

### Two entry points, one implementation

- **Public `GET /api/search`** — unauthenticated by design (serves site
  readers), rate-limited like the content API, and restricted to
  **published** articles only. Drafts and archived entries are never
  returned, matching the public pages' visibility rules.
- **Token-gated `q` param on `GET /api/articles`** — the management surface;
  searches **every status** (drafts and archived included). This is what the
  MCP `search_articles` tool calls, so agents can find content to manage.

### Alternatives considered

| Option | Verdict |
|---|---|
| SQLite FTS5 (chosen) | Real full-text search (bm25 ranking, prefix matching, case-insensitive), zero deps, lives in the existing DB |
| `LIKE`-based SQL | Substring-only, no ranking — fallback only |
| Client-side search | Ships full content to every visitor, needs a public dump endpoint |
| External service (Algolia/Meilisearch) | Overkill for a small blog, new dependency + data egress |

### Security disposition

The public route returns only published articles with fields the public pages
already render — no new exposure. Query sanitization prevents FTS5 injection.
The management search stays behind the existing bearer-token gate.