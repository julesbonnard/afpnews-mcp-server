import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../tools/index.js';
import { registerResources } from '../resources/index.js';
import { registerPrompts } from '../prompts/index.js';
import { FIXTURE_DOC, makeDocs } from './fixtures.js';

function createMockApicore() {
  return {
    search: vi.fn().mockResolvedValue({ documents: makeDocs(3), count: 3 }),
    get: vi.fn().mockResolvedValue(makeDocs(1)[0]),
    mlt: vi.fn().mockResolvedValue({ documents: makeDocs(2), count: 2 }),
    list: vi.fn().mockResolvedValue([{ key: 'economy', count: 42 }]),
  };
}

async function setupServer() {
  const server = new McpServer({ name: 'test', version: '0.0.1' });
  const apicore = createMockApicore();
  const ctx = { server, apicore } as any;

  registerTools(ctx);
  registerResources(ctx);
  registerPrompts(ctx);

  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { server, client, apicore };
}

describe('MCP integration', () => {
  let client: Client;
  let apicore: ReturnType<typeof createMockApicore>;

  beforeEach(async () => {
    const setup = await setupServer();
    client = setup.client;
    apicore = setup.apicore;
  });

  describe('afp_search_articles tool', () => {
    it('returns pagination line and markdown with UNO and title', async () => {
      const result = await client.callTool({ name: 'afp_search_articles', arguments: { query: 'test' } });
      // 1 pagination line + 3 documents
      expect(result.content).toHaveLength(4);
      const pagination = result.content![0] as { type: string; text: string };
      expect(pagination.text).toContain('Showing 3 of 3 results');
      const first = result.content![1] as { type: string; text: string };
      expect(first.type).toBe('text');
      expect(first.text).toContain('## Article 1');
      expect(first.text).toContain('UNO: AFP-TEST-001');
    });

    it('returns text message on empty results', async () => {
      apicore.search.mockResolvedValueOnce({ documents: [], count: 0 });
      const result = await client.callTool({ name: 'afp_search_articles', arguments: { query: 'nothing' } });
      expect(result.content).toHaveLength(1);
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toBe('No results found.');
    });

    it('returns excerpt by default (no fullText)', async () => {
      apicore.search.mockResolvedValueOnce({ documents: [FIXTURE_DOC], count: 1 });
      const result = await client.callTool({ name: 'afp_search_articles', arguments: { query: 'test' } });
      // pagination line + 1 document
      const msg = result.content![1] as { type: string; text: string };
      expect(msg.text).toContain('Fourth paragraph wraps up.');
      expect(msg.text).not.toContain('Fifth paragraph is extra content.');
    });

    it('returns full text when fullText=true', async () => {
      apicore.search.mockResolvedValueOnce({ documents: [FIXTURE_DOC], count: 1 });
      const result = await client.callTool({ name: 'afp_search_articles', arguments: { query: 'test', fullText: true } });
      const msg = result.content![1] as { type: string; text: string };
      expect(msg.text).toContain('Fifth paragraph is extra content.');
    });

    it('preset a-la-une applies filters and defaults to full text', async () => {
      apicore.search.mockResolvedValueOnce({ documents: [FIXTURE_DOC], count: 1 });
      const result = await client.callTool({ name: 'afp_search_articles', arguments: { preset: 'a-la-une' } });
      const msg = result.content![1] as { type: string; text: string };
      expect(msg.text).toContain('Fifth paragraph is extra content.');

      const [request] = apicore.search.mock.calls.at(-1)!;
      expect(request.product).toEqual(['news']);
      expect(request.lang).toEqual(['fr']);
      expect(request.slug).toEqual(['afp', 'actualites']);
      expect(request.dateFrom).toBe('now-1d');
      expect(request.size).toBe(1);
    });

    it('shows pagination info when there are more results', async () => {
      apicore.search.mockResolvedValueOnce({ documents: makeDocs(3), count: 10 });
      const result = await client.callTool({ name: 'afp_search_articles', arguments: { query: 'test' } });
      const pagination = result.content![0] as { type: string; text: string };
      expect(pagination.text).toContain('Showing 3 of 10 results');
      expect(pagination.text).toContain('offset=3');
    });

    it('returns isError on API failure', async () => {
      apicore.search.mockRejectedValueOnce(new Error('Network timeout'));
      const result = await client.callTool({ name: 'afp_search_articles', arguments: { query: 'test' } });
      expect(result.isError).toBe(true);
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('Network timeout');
    });
  });

  describe('afp_get_article tool', () => {
    it('returns full document with fullText', async () => {
      const result = await client.callTool({ name: 'afp_get_article', arguments: { uno: 'AFP-TEST-001' } });
      expect(result.content).toHaveLength(1);
      const doc = result.content![0] as { type: string; text: string };
      expect(doc.type).toBe('text');
      expect(doc.text).toContain('## Article 1');
    });

    it('returns isError on API failure', async () => {
      apicore.get.mockRejectedValueOnce(new Error('Not found'));
      const result = await client.callTool({ name: 'afp_get_article', arguments: { uno: 'BAD-UNO' } });
      expect(result.isError).toBe(true);
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('BAD-UNO');
      expect(msg.text).toContain('Not found');
    });
  });

  describe('afp_find_similar tool', () => {
    it('returns summary line and formatted similar documents', async () => {
      const result = await client.callTool({ name: 'afp_find_similar', arguments: { uno: 'AFP-TEST-001', lang: 'fr' } });
      // 1 summary line + 2 documents
      expect(result.content).toHaveLength(3);
      const summary = result.content![0] as { type: string; text: string };
      expect(summary.text).toContain('Found 2 similar articles');
      const first = result.content![1] as { type: string; text: string };
      expect(first.text).toContain('UNO:');
    });

    it('returns text message on empty results', async () => {
      apicore.mlt.mockResolvedValueOnce({ documents: [], count: 0 });
      const result = await client.callTool({ name: 'afp_find_similar', arguments: { uno: 'AFP-TEST-001', lang: 'fr' } });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toBe('No similar articles found.');
    });

    it('returns isError on API failure', async () => {
      apicore.mlt.mockRejectedValueOnce(new Error('Invalid UNO'));
      const result = await client.callTool({ name: 'afp_find_similar', arguments: { uno: 'BAD', lang: 'fr' } });
      expect(result.isError).toBe(true);
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('Invalid UNO');
    });
  });

  describe('afp_list_facets tool', () => {
    it('returns markdown-formatted facet list', async () => {
      const result = await client.callTool({ name: 'afp_list_facets', arguments: { facet: 'slug' } });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.type).toBe('text');
      expect(msg.text).toContain('## Facet: slug');
      expect(msg.text).toContain('**economy**');
      expect(msg.text).toContain('42 articles');
    });

    it('returns isError when facet is missing without preset', async () => {
      const result = await client.callTool({ name: 'afp_list_facets', arguments: {} });
      expect(result.isError).toBe(true);
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('Missing required parameter: facet');
    });

    it('preset trending-topics applies list overrides', async () => {
      const result = await client.callTool({ name: 'afp_list_facets', arguments: { preset: 'trending-topics' } });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('## Trending Topics');
      expect(msg.text).toContain('42 articles');

      const [facet, params, limit] = apicore.list.mock.calls.at(-1)!;
      expect(facet).toBe('slug');
      expect(params).toMatchObject({ langs: ['fr'], product: ['news'], dateFrom: 'now-1d' });
      expect(limit).toBe(20);
    });

    it('returns isError on API failure', async () => {
      apicore.list.mockRejectedValueOnce(new Error('Service unavailable'));
      const result = await client.callTool({ name: 'afp_list_facets', arguments: { facet: 'slug' } });
      expect(result.isError).toBe(true);
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('Service unavailable');
    });
  });

  describe('resources', () => {
    it('topics resource returns catalog', async () => {
      const result = await client.readResource({ uri: 'afp://topics' });
      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text as string);
      expect(parsed).toHaveProperty('fr');
      expect(parsed).toHaveProperty('en');
    });
  });

  describe('prompts', () => {
    it('daily-briefing returns user message with new tool name', async () => {
      const result = await client.getPrompt({ name: 'daily-briefing', arguments: {} });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).toContain('afp_search_articles');
    });

    it('country-news returns user message with country', async () => {
      const result = await client.getPrompt({ name: 'country-news', arguments: { country: 'fra' } });
      expect(result.messages).toHaveLength(1);
      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).toContain('fra');
    });

    it('comprehensive-analysis references new tool names', async () => {
      const result = await client.getPrompt({ name: 'comprehensive-analysis', arguments: { query: 'test' } });
      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).toContain('afp_search_articles');
      expect(content.text).toContain('afp_find_similar');
      expect(content.text).toContain('afp_get_article');
    });
  });
});
