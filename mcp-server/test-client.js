/**
 * Smoke test for the Agentic Blog MCP server.
 *
 * Connects as an MCP client over Streamable HTTP, lists the available tools,
 * then exercises the full publish → read → update → delete cycle against the
 * content API (via the MCP server).
 *
 * Usage: node test-client.js [mcpUrl] [token]
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.argv[2] ?? 'http://127.0.0.1:3456/mcp';
const TOKEN = process.argv[3];

const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
  requestInit: TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined,
});
const client = new Client({ name: 'agentic-blog-mcp-smoke-test', version: '0.1.0' });
await client.connect(transport);

console.log('=== tools/list ===');
const { tools } = await client.listTools();
console.log(tools.map((t) => t.name).join(', '));

console.log('\n=== publish_article ===');
const created = await client.callTool({
  name: 'publish_article',
  arguments: {
    article: {
      title: 'MCP smoke test entry',
      dek: 'Temporary entry created through the MCP server to verify the tool chain.',
      logged: '16 Sep 2026',
      status: 'published',
      tags: ['test', 'mcp'],
      sections: [{ heading: 'Test', paragraphs: ['Created via MCP publish_article.'] }],
      sources: [{ label: 'Example', url: 'https://example.com' }],
    },
  },
});
console.log(created.content[0].text);

console.log('\n=== get_article ===');
const fetched = await client.callTool({
  name: 'get_article',
  arguments: { slug: 'mcp-smoke-test-entry' },
});
console.log(JSON.parse(fetched.content[0].text).title);

console.log('\n=== update_article ===');
const updated = await client.callTool({
  name: 'update_article',
  arguments: {
    slug: 'mcp-smoke-test-entry',
    article: {
      slug: 'mcp-smoke-test-entry',
      title: 'MCP smoke test entry (updated)',
      dek: 'Updated through the MCP server.',
      logged: '16 Sep 2026',
      status: 'archived',
      tags: ['test', 'mcp'],
      sections: [{ heading: 'Test', paragraphs: ['Updated via MCP update_article.'] }],
    },
  },
});
console.log(updated.content[0].text);

console.log('\n=== delete_article ===');
const deleted = await client.callTool({
  name: 'delete_article',
  arguments: { slug: 'mcp-smoke-test-entry' },
});
console.log(deleted.content[0].text);

console.log('\n=== list_articles (count) ===');
const listed = await client.callTool({ name: 'list_articles', arguments: {} });
const all = JSON.parse(listed.content[0].text);
console.log('total articles:', all.length);

await client.close();
console.log('\nAll MCP tool calls succeeded.');