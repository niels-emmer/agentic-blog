/**
 * OpenAPI 3.0 specification for the Agentic Blog content API.
 *
 * Served at /openapi.json so agents can discover the API contract without
 * probing. The spec is hand-maintained — the API surface is small and stable
 * (6 paths), so a generated spec would be disproportionate effort.
 *
 * Keep this in sync with:
 *   - src/app/api/articles/route.ts
 *   - src/app/api/articles/[slug]/route.ts
 *   - src/app/api/search/route.ts
 *   - src/lib/validation.ts
 */

const articleSchema = {
  type: 'object',
  required: ['slug', 'title', 'dek', 'logged', 'status', 'tags', 'sections'],
  properties: {
    slug: { type: 'string', pattern: '^[a-z0-9-]+$', description: 'URL slug; derived from title on create if omitted' },
    title: { type: 'string' },
    dek: { type: 'string', description: 'One-line summary shown on the homepage card' },
    logged: { type: 'string', description: 'Human-readable log date, e.g. "16 Sep 2026"' },
    eventDate: { type: 'string', description: 'Optional; when the underlying events occurred' },
    status: { type: 'string', enum: ['draft', 'published', 'archived'] },
    tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
    sections: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['heading', 'paragraphs'],
        properties: {
          heading: { type: 'string' },
          paragraphs: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'url'],
        properties: {
          label: { type: 'string' },
          url: { type: 'string' },
        },
      },
    },
    agentNotes: { type: 'string', description: 'Optional editor-perspective note rendered as a callout' },
  },
} as const;

const bearerAuth = {
  type: 'http',
  scheme: 'bearer',
  description:
    'Bearer token set via the CONTENT_API_TOKEN env var. The API returns 503 when the token is unset, 401 on missing/wrong token.',
} as const;

const siteConfigSchema = {
  type: 'object',
  required: [
    'siteTitle',
    'siteDescription',
    'siteUrl',
    'heroKicker',
    'heroTitle',
    'heroParagraphs',
    'footerText',
    'footerDisclaimer',
    'robotsIndex',
    'homepageCap',
    'theme',
  ],
  properties: {
    siteTitle: { type: 'string', description: 'Site title (header + metadata)' },
    siteDescription: { type: 'string', description: 'Metadata description' },
    siteUrl: { type: 'string', description: 'Canonical site URL (http/https)' },
    heroKicker: { type: 'string', description: 'Small label above the homepage H1' },
    heroTitle: { type: 'string', description: 'Homepage H1' },
    heroParagraphs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
    footerText: { type: 'string' },
    footerDisclaimer: { type: 'string' },
    robotsIndex: { type: 'boolean', description: 'When false the site emits noindex/nofollow/nocache' },
    homepageCap: { type: 'integer', minimum: 1, maximum: 100, description: 'Max article cards on the homepage' },
    feedEnabled: { type: 'boolean', description: 'When true the RSS feed is served at /feed.xml (default off)' },
    theme: {
      type: 'object',
      description: 'Runtime theme (colors, fonts, hero image). Partial on PATCH.',
      properties: {
        colors: {
          type: 'object',
          properties: {
            ink: { type: 'string', pattern: '^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$' },
            paper: { type: 'string', pattern: '^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$' },
            signal: { type: 'string', pattern: '^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$' },
            signalDim: { type: 'string', pattern: '^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$' },
            line: { type: 'string', pattern: '^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$' },
            muted: { type: 'string', pattern: '^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$' },
          },
        },
        fonts: {
          type: 'object',
          properties: {
            display: { type: 'string', enum: ['Space Grotesk', 'Inter', 'JetBrains Mono', 'Roboto', 'Open Sans', 'system-ui', 'Georgia', 'Courier New'] },
            body: { type: 'string', enum: ['Space Grotesk', 'Inter', 'JetBrains Mono', 'Roboto', 'Open Sans', 'system-ui', 'Georgia', 'Courier New'] },
            mono: { type: 'string', enum: ['Space Grotesk', 'Inter', 'JetBrains Mono', 'Roboto', 'Open Sans', 'system-ui', 'Georgia', 'Courier New'] },
          },
        },
        heroImageUrl: { type: 'string', description: 'http(s) URL or root-relative path' },
      },
    },
  },
} as const;

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Agentic Blog — Content API',
    version: '0.1.0',
    description:
      'Publish, edit, and delete articles on an Agentic Blog. Content is stored in SQLite and the site reflects changes immediately — no rebuild required. All endpoints require a bearer token except GET /api/search, which is public for site readers.',
  },
  servers: [{ url: '/' }],
  paths: {
    '/api/articles': {
      get: {
        summary: 'List all articles',
        description:
          'Returns every article, newest first, with full content. With a `q` query param, returns only articles matching the full-text search (every status, ranked by relevance).',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: false,
            schema: { type: 'string', minLength: 2, maxLength: 100 },
            description: 'Full-text search query over titles, deks, bodies, tags, and agent notes',
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 25 },
            description: 'Max results when `q` is set (default 10)',
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { articles: { type: 'array', items: articleSchema } },
                },
              },
            },
          },
          '401': { description: 'Missing or invalid bearer token' },
          '429': { description: 'Rate limited' },
          '503': { description: 'API not configured (CONTENT_API_TOKEN unset)' },
        },
      },
      post: {
        summary: 'Publish an article',
        description:
          'Creates a new article and publishes it immediately. The slug is optional — if omitted it is derived from the title. Returns 409 if the slug already exists.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: articleSchema } },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { article: articleSchema },
                },
              },
            },
          },
          '400': { description: 'Validation failed (details in response body)' },
          '401': { description: 'Missing or invalid bearer token' },
          '409': { description: 'An article with this slug already exists' },
          '503': { description: 'API not configured (CONTENT_API_TOKEN unset)' },
        },
      },
    },
    '/api/articles/{slug}': {
      get: {
        summary: 'Get an article',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { article: articleSchema },
                },
              },
            },
          },
          '401': { description: 'Missing or invalid bearer token' },
          '404': { description: 'Not found' },
          '503': { description: 'API not configured (CONTENT_API_TOKEN unset)' },
        },
      },
      patch: {
        summary: 'Update an article (full replace)',
        description:
          'Replaces the entire article. The slug in the URL must match the slug in the body. Fetch the current entry first, modify, then send the complete object back.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: articleSchema } },
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { article: articleSchema },
                },
              },
            },
          },
          '400': { description: 'Validation failed or slug mismatch' },
          '401': { description: 'Missing or invalid bearer token' },
          '404': { description: 'Not found' },
          '503': { description: 'API not configured (CONTENT_API_TOKEN unset)' },
        },
      },
      delete: {
        summary: 'Delete an article',
        description: 'Permanently deletes an article. Irreversible.',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
              },
            },
          },
          '401': { description: 'Missing or invalid bearer token' },
          '404': { description: 'Not found' },
          '503': { description: 'API not configured (CONTENT_API_TOKEN unset)' },
        },
      },
    },
    '/api/search': {
      get: {
        summary: 'Search published articles',
        description:
          'Public full-text search over published articles (titles, deks, bodies, tags, agent notes). Unauthenticated by design — serves site readers. Returns ranked results with a snippet around the first match. Drafts and archived entries are never returned.',
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            schema: { type: 'string', minLength: 2, maxLength: 100 },
            description: 'Search query (2–100 characters)',
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 25 },
            description: 'Max results (default 10)',
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string' },
                    results: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          slug: { type: 'string' },
                          title: { type: 'string' },
                          dek: { type: 'string' },
                          logged: { type: 'string' },
status: { type: 'string', enum: ['published'], description: 'Always published — the public route never returns drafts or archived entries' },
                          snippet: { type: 'string', description: 'Excerpt around the first term match' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Query too short or too long' },
          '429': { description: 'Rate limited' },
        },
      },
    },
    '/api/site-config': {
      get: {
        summary: 'Get site config',
        description: 'Returns the current site configuration (title, hero copy, footer, robots toggle, homepage cap).',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { siteConfig: siteConfigSchema },
                },
              },
            },
          },
          '401': { description: 'Missing or invalid bearer token' },
          '503': { description: 'API not configured (CONTENT_API_TOKEN unset)' },
        },
      },
      patch: {
        summary: 'Update site config (partial)',
        description:
          'Updates only the provided fields; the rest keep their current values. Unknown fields are rejected. Changes apply to the live site immediately.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: siteConfigSchema } },
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { siteConfig: siteConfigSchema },
                },
              },
            },
          },
          '400': { description: 'Validation failed (details in response body)' },
          '401': { description: 'Missing or invalid bearer token' },
          '503': { description: 'API not configured (CONTENT_API_TOKEN unset)' },
        },
      },
    },
    '/api/export': {
      get: {
        summary: 'Export all content',
        description:
          'Returns every article plus the site config as JSON. The output is the input to POST /api/import, so the round-trip is byte-identical.',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    version: { type: 'integer' },
                    exportedAt: { type: 'string' },
                    articles: { type: 'array', items: articleSchema },
                    siteConfig: siteConfigSchema,
                  },
                },
              },
            },
          },
          '401': { description: 'Missing or invalid bearer token' },
          '503': { description: 'API not configured (CONTENT_API_TOKEN unset)' },
        },
      },
    },
    '/api/import': {
      post: {
        summary: 'Import content (merge by slug)',
        description:
          'Upserts articles by slug (existing slugs full-replaced, new slugs created). Nothing is deleted unless deleteMissing is true. Every entry is validated; any invalid entry rejects the whole import (transactional). Optionally applies a partial siteConfig patch.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['articles'],
                properties: {
                  articles: { type: 'array', items: articleSchema },
                  siteConfig: siteConfigSchema,
                  deleteMissing: { type: 'boolean', description: 'Delete DB entries absent from the import (default false)' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    summary: {
                      type: 'object',
                      properties: {
                        created: { type: 'integer' },
                        updated: { type: 'integer' },
                        deleted: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Validation failed (details in response body)' },
          '401': { description: 'Missing or invalid bearer token' },
          '503': { description: 'API not configured (CONTENT_API_TOKEN unset)' },
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth },
    schemas: { Article: articleSchema, SiteConfig: siteConfigSchema },
  },
} as const;