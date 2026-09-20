/**
 * Agentic Blog — MCP server
 *
 * Exposes the site's content API as MCP tools so an agent can publish/edit
 * articles without a git push → deploy → rebuild cycle.
 *
 * The server is a thin HTTP client over the content API:
 *
 *   agent ──MCP tools──▶ this server ──HTTP + bearer token──▶ /api/articles
 *
 * Environment:
 *   CONTENT_API_URL      base URL of the site's content API (default http://localhost:3000)
 *   CONTENT_API_TOKEN    bearer token for the content API (required)
 *   MCP_TOKEN            bearer token clients must present to THIS server.
 *                        REQUIRED when binding to a non-loopback host — the
 *                        server refuses to start otherwise (fail closed).
 *   MCP_HOST             bind host (default 127.0.0.1)
 *   MCP_PORT             bind port (default 3456)
 *   MCP_ALLOWED_HOSTS    comma-separated Host-header allowlist for DNS
 *                        rebinding protection (default: localhost,127.0.0.1,::1)
 *
 * Transport: MCP Streamable HTTP (stateless, per the 2026-07-28 protocol
 * revision). Clients connect to http://<host>:<port>/mcp.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const API_URL = process.env.CONTENT_API_URL ?? 'http://localhost:3000';
const API_TOKEN = process.env.CONTENT_API_TOKEN;
const MCP_TOKEN = process.env.MCP_TOKEN;
const HOST = process.env.MCP_HOST ?? '127.0.0.1';
const PORT = Number(process.env.MCP_PORT ?? 3456);
const ALLOWED_HOSTS = (process.env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,::1')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Startup validation (fail closed)
// ---------------------------------------------------------------------------

if (!API_TOKEN) {
  console.error('CONTENT_API_TOKEN is required (bearer token for the content API).');
  process.exit(1);
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`MCP_PORT must be an integer between 1 and 65535 (got "${process.env.MCP_PORT}").`);
  process.exit(1);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const isLoopback = LOOPBACK_HOSTS.has(HOST.toLowerCase());

// H-1: never run unauthenticated on a non-loopback interface. If the operator
// explicitly binds 0.0.0.0 (LAN/internet exposure), a token is mandatory.
if (!MCP_TOKEN && !isLoopback) {
  console.error(
    'Refusing to start: MCP_TOKEN is required when binding to a non-loopback host ' +
      `(MCP_HOST=${HOST}). Set a strong token, or bind to 127.0.0.1.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Constant-time string comparison (lengths equalized via SHA-256). */
function safeEqual(a, b) {
  const aDigest = createHash('sha256').update(a).digest();
  const bDigest = createHash('sha256').update(b).digest();
  return timingSafeEqual(aDigest, bDigest);
}

/** Fixed-window in-memory rate limiter keyed by client address. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const rateWindows = new Map();
function rateLimited(key) {
  const now = Date.now();
  const window = rateWindows.get(key);
  if (!window || window.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  window.count += 1;
  return window.count > RATE_MAX;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of rateWindows) {
    if (window.resetAt <= now) rateWindows.delete(key);
  }
}, RATE_WINDOW_MS).unref();

const MAX_BODY_BYTES = 1_000_000; // 1 MB
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Content API client
// ---------------------------------------------------------------------------

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    // Log the full upstream body server-side; surface only a sanitized
    // message to the MCP client.
    console.error(`API ${method} ${path} failed (${res.status}): ${text.slice(0, 2000)}`);
    const detail =
      typeof data === 'object' && data !== null && typeof data.error === 'string'
        ? data.error
        : `upstream returned ${res.status}`;
    throw new Error(`API ${method} ${path} failed (${res.status}): ${detail}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Tool schemas (limits mirror src/lib/validation.ts)
// ---------------------------------------------------------------------------

const articleSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).max(100).optional(),
  title: z.string().min(1).max(200),
  dek: z.string().min(1).max(500),
  logged: z.string().min(1).max(100),
  eventDate: z.string().max(200).optional(),
  status: z.enum(['draft', 'published', 'archived']),
  tags: z.array(z.string().min(1).max(50)).min(1).max(20),
  sections: z
    .array(
      z.object({
        heading: z.string().min(1).max(200),
        paragraphs: z.array(z.string().max(20_000)).min(1).max(50),
      }),
    )
    .min(1)
    .max(50),
  sources: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        url: z
          .string()
          .max(2_000)
          .refine((u) => {
            try {
              const parsed = new URL(u);
              return parsed.protocol === 'http:' || parsed.protocol === 'https:';
            } catch {
              return false;
            }
          }, 'url must be an http(s) URL'),
      }),
    )
    .max(50)
    .optional(),
  agentNotes: z.string().max(10_000).optional(),
});

// ---------------------------------------------------------------------------
// Server factory — a fresh McpServer is created per request (stateless mode)
// ---------------------------------------------------------------------------

function createServer() {
  const server = new McpServer({ name: 'agentic-blog', version: '0.1.0' });

  server.registerTool(
    'list_articles',
    {
      title: 'List articles',
      description:
        'List all articles, newest first. Returns the full content of every entry.',
    },
    async () => {
      const data = await api('/api/articles');
      return { content: [{ type: 'text', text: JSON.stringify(data.articles, null, 2) }] };
    },
  );

  server.registerTool(
    'get_article',
    {
      title: 'Get an article',
      description: 'Fetch a single article by its slug.',
      inputSchema: { slug: z.string().min(1).max(100) },
    },
    async ({ slug }) => {
      const data = await api(`/api/articles/${encodeURIComponent(slug)}`);
      return { content: [{ type: 'text', text: JSON.stringify(data.article, null, 2) }] };
    },
  );

  server.registerTool(
    'search_articles',
    {
      title: 'Search articles',
      description:
        'Full-text search over article titles, deks, section bodies, tags, and agent notes. Returns matching articles (every status — drafts and archived included, since this is the management surface) ranked by relevance, with full content. Use this to find an article by keyword before fetching or updating it.',
      inputSchema: {
        q: z.string().min(2).max(100),
        limit: z.number().int().min(1).max(25).optional(),
      },
    },
    async ({ q, limit }) => {
      const params = new URLSearchParams({ q });
      if (limit !== undefined) params.set('limit', String(limit));
      const data = await api(`/api/articles?${params.toString()}`);
      return { content: [{ type: 'text', text: JSON.stringify(data.articles, null, 2) }] };
    },
  );

  server.registerTool(
    'publish_article',
    {
      title: 'Publish an article',
      description:
        'Create a new article and publish it to the site immediately. The slug is optional — if omitted it is derived from the title. The site reflects the new entry without any rebuild.',
      inputSchema: { article: articleSchema },
    },
    async ({ article }) => {
      const data = await api('/api/articles', { method: 'POST', body: article });
      return {
        content: [
          {
            type: 'text',
            text: `Published article "${data.article.title}" at /articles/${data.article.slug}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'update_article',
    {
      title: 'Update an article',
      description:
        'Replace an existing article entirely (full-replace semantics). The slug in the URL must match the slug in the body. Fetch the current entry first, modify, then send the complete object back.',
      inputSchema: { slug: z.string().min(1).max(100), article: articleSchema },
    },
    async ({ slug, article }) => {
      const data = await api(`/api/articles/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        body: article,
      });
      return {
        content: [
          {
            type: 'text',
            text: `Updated article "${data.article.title}" at /articles/${data.article.slug}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'delete_article',
    {
      title: 'Delete an article',
      description:
        'Permanently delete an article by slug. This is irreversible — confirm with the human operator before calling.',
      inputSchema: { slug: z.string().min(1).max(100) },
    },
    async ({ slug }) => {
      await api(`/api/articles/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      return { content: [{ type: 'text', text: `Deleted article ${slug}` }] };
    },
  );

  // Site config tools — limits mirror src/lib/validation.ts (validateSiteConfig).
  // .strict() rejects unknown fields (matching the API) and .trim() rejects
  // whitespace-only strings the same way the API's isNonEmptyString does.
  const hexColor = z
    .string()
    .regex(/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$/)
    .transform((v) => v.toLowerCase());
  const fontName = z.enum([
    'Space Grotesk',
    'Inter',
    'JetBrains Mono',
    'Roboto',
    'Open Sans',
    'system-ui',
    'Georgia',
    'Courier New',
  ]);
  const siteConfigSchema = z
    .object({
      siteTitle: z.string().trim().min(1).max(200).optional(),
      siteDescription: z.string().trim().min(1).max(500).optional(),
      siteUrl: z
        .string()
        .trim()
        .min(1)
        .max(2_000)
        .refine((u) => {
          try {
            const parsed = new URL(u);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
          } catch {
            return false;
          }
        }, 'siteUrl must be an http(s) URL')
        .optional(),
      heroKicker: z.string().trim().min(1).max(200).optional(),
      heroTitle: z.string().trim().min(1).max(200).optional(),
      heroParagraphs: z.array(z.string().trim().min(1).max(2_000)).min(1).max(10).optional(),
      footerText: z.string().trim().min(1).max(2_000).optional(),
      footerDisclaimer: z.string().trim().min(1).max(2_000).optional(),
      robotsIndex: z.boolean().optional(),
      homepageCap: z.number().int().min(1).max(100).optional(),
      feedEnabled: z.boolean().optional(),
      theme: z
        .object({
          colors: z
            .object({
              ink: hexColor.optional(),
              paper: hexColor.optional(),
              signal: hexColor.optional(),
              signalDim: hexColor.optional(),
              line: hexColor.optional(),
              muted: hexColor.optional(),
            })
            .strict()
            .optional(),
          fonts: z
            .object({
              display: fontName.optional(),
              body: fontName.optional(),
              mono: fontName.optional(),
            })
            .strict()
            .optional(),
          heroImageUrl: z
            .string()
            .refine(
              (u) => u === '' || (u.startsWith('/') && !u.startsWith('//')) || (() => {
                try {
                  const parsed = new URL(u);
                  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
                } catch {
                  return false;
                }
              })(),
              'heroImageUrl must be empty, an http(s) URL, or a root-relative path',
            )
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict();

  server.registerTool(
    'get_site_config',
    {
      title: 'Get site config',
      description:
        'Fetch the current site configuration: site title/description/URL, hero kicker/title/paragraphs, footer texts, the robots indexing toggle, and the homepage article cap.',
    },
    async () => {
      const data = await api('/api/site-config');
      return { content: [{ type: 'text', text: JSON.stringify(data.siteConfig, null, 2) }] };
    },
  );

  server.registerTool(
    'update_site_config',
    {
      title: 'Update site config',
      description:
        'Update site configuration fields. Partial update — only the fields you provide are changed; the rest keep their current values. Fields: siteTitle, siteDescription, siteUrl, heroKicker, heroTitle, heroParagraphs (array of strings), footerText, footerDisclaimer, robotsIndex (boolean), homepageCap (integer 1-100), feedEnabled (boolean — enables the RSS feed at /feed.xml), theme (object with colors {ink, paper, signal, signalDim, line, muted} as hex strings, fonts {display, body, mono} from the allow-list, heroImageUrl as an http(s) URL or root-relative path).',
      inputSchema: { fields: siteConfigSchema },
    },
    async ({ fields }) => {
      const data = await api('/api/site-config', { method: 'PATCH', body: fields });
      return {
        content: [{ type: 'text', text: JSON.stringify(data.siteConfig, null, 2) }],
      };
    },
  );

  server.registerTool(
    'export_content',
    {
      title: 'Export all content',
      description:
        'Export the full site content as JSON: every article plus the site config. The output can be fed back into import_content to restore or migrate the site.',
    },
    async () => {
      const data = await api('/api/export');
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.registerTool(
    'import_content',
    {
      title: 'Import content (merge by slug)',
      description:
        'Import articles with merge-by-slug semantics: existing slugs are full-replaced, new slugs are created, and nothing is deleted unless deleteMissing is explicitly true. Every entry is validated; if any entry is invalid the whole import is rejected. Optionally applies a partial siteConfig patch. Returns a summary of created/updated/deleted counts.',
      inputSchema: {
        // Import requires slugs (they are the merge key) — stricter than the
        // shared articleSchema used by publish_article.
        articles: z.array(articleSchema.extend({ slug: z.string().regex(/^[a-z0-9-]+$/).max(100) })),
        siteConfig: siteConfigSchema.optional(),
        deleteMissing: z.boolean().optional(),
      },
    },
    async ({ articles, siteConfig, deleteMissing }) => {
      const data = await api('/api/import', {
        method: 'POST',
        body: { articles, ...(siteConfig ? { siteConfig } : {}), ...(deleteMissing ? { deleteMissing: true } : {}) },
      });
      return {
        content: [
          {
            type: 'text',
            text: `Import complete: ${data.summary.created} created, ${data.summary.updated} updated, ${data.summary.deleted} deleted.`,
          },
        ],
      };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// HTTP server (Streamable HTTP transport, stateless)
// ---------------------------------------------------------------------------

function hostAllowed(hostHeader) {
  if (!hostHeader) return false;
  try {
    // new URL handles IPv6 bracket forms ([::1]:3456) and strips the port.
    const host = new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return ALLOWED_HOSTS.includes(host);
  } catch {
    return false;
  }
}

function originAllowed(originHeader) {
  if (!originHeader) return false;
  try {
    const origin = new URL(originHeader);
    const host = origin.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return ALLOWED_HOSTS.includes(host);
  } catch {
    return false;
  }
}

const httpServer = http.createServer(async (req, res) => {
  // Only the /mcp endpoint is served.
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // DNS-rebinding protection: validate the Host header and any Origin header
  // against the configured allowlist.
  if (!hostAllowed(req.headers.host ?? '')) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden host' }));
    return;
  }
  if (req.headers.origin && !originAllowed(req.headers.origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden origin' }));
    return;
  }

  // Bearer-token gate for incoming MCP connections (mandatory on
  // non-loopback binds; enforced at startup).
  if (MCP_TOKEN && !safeEqual(req.headers.authorization ?? '', `Bearer ${MCP_TOKEN}`)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Rate limit by client address.
  const clientAddr = req.socket.remoteAddress ?? 'unknown';
  if (rateLimited(clientAddr)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Too many requests' }));
    return;
  }

  // Reject oversized bodies up front (Content-Length) and cap accumulation.
  const contentLength = Number(req.headers['content-length'] ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Request body too large' }));
    return;
  }

  // Request timeout so a stalled client cannot hold the connection forever.
  req.setTimeout(REQUEST_TIMEOUT_MS, () => {
    res.writeHead(408, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Request timeout' }));
    req.destroy();
  });

  // Read the request body (JSON-RPC), stopping once the cap is exceeded.
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body too large' }));
      return;
    }
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString('utf-8');
  let parsedBody;
  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = undefined;
    }
  }

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  // Register cleanup BEFORE awaiting so a throw in connect/handleRequest
  // cannot leak the transport (and its SSE timers) or the server.
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        }),
      );
    }
  }
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Agentic Blog MCP server listening on http://${HOST}:${PORT}/mcp`);
  console.log(`Content API: ${API_URL}`);
  console.log(`Incoming auth: ${MCP_TOKEN ? 'bearer token required' : 'disabled (loopback bind only)'}`);
  console.log(`Allowed hosts: ${ALLOWED_HOSTS.join(', ')}`);
});