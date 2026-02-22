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
    list: vi.fn().mockResolvedValue([{ name: 'economy', count: 42 }]),
  };
}

function getText(result: any, index = 0): string {
  return (result.content[index] as { type: string; text: string }).text;
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

    it('returns json with total, shown, offset and documents array', async () => {
      const result = await client.callTool({ name: 'afp_search_articles', arguments: { query: 'test', format: 'json' } });
      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse(getText(result));
      expect(parsed.total).toBe(3);
      expect(parsed.shown).toBe(3);
      expect(parsed.offset).toBe(0);
      expect(parsed.documents).toHaveLength(3);
      expect(parsed.documents[0]).toHaveProperty('uno');
      expect(parsed.documents[0]).toHaveProperty('headline');
      expect(parsed.documents[0]).not.toHaveProperty('news');
    });

    it('returns json with only requested fields', async () => {
      const result = await client.callTool({ name: 'afp_search_articles', arguments: { query: 'test', format: 'json', fields: ['uno', 'headline'] } });
      const parsed = JSON.parse(getText(result));
      expect(Object.keys(parsed.documents[0])).toEqual(['uno', 'headline']);
    });

    it('returns csv with header and data rows', async () => {
      const result = await client.callTool({ name: 'afp_search_articles', arguments: { query: 'test', format: 'csv' } });
      expect(result.content).toHaveLength(1);
      const lines = getText(result).split('\n');
      expect(lines[0]).toBe('uno,headline,lang,genre');
      expect(lines).toHaveLength(4); // header + 3 docs
    });

    it('returns csv with custom fields', async () => {
      const result = await client.callTool({ name: 'afp_search_articles', arguments: { query: 'test', format: 'csv', fields: ['uno', 'headline'] } });
      const lines = getText(result).split('\n');
      expect(lines[0]).toBe('uno,headline');
      expect(lines[1]).toContain('AFP-TEST-001');
      expect(lines[1]).toContain('Article 1');
    });
  });

  describe('afp_get_article tool', () => {
    it('returns formatted full article with metadata rows and body', async () => {
      apicore.get.mockResolvedValueOnce(FIXTURE_DOC);
      const result = await client.callTool({ name: 'afp_get_article', arguments: { uno: 'AFP-TEST-001' } });
      expect(result.content).toHaveLength(1);
      const text = getText(result);
      expect(text).toContain('## Test Article Headline');
      expect(text).toContain('**UNO:** AFP-TEST-001');
      expect(text).toContain('**Lang:** fr');
      expect(text).toContain('**Genre:** news');
      expect(text).toContain('**Status:** Usable');
      expect(text).toContain('**Signal:** update');
      expect(text).toContain('**Advisory:** CORRECTION');
      expect(text).toContain('---');
      expect(text).toContain('Fifth paragraph is extra content.');
    });

    it('does not include missing optional fields', async () => {
      apicore.get.mockResolvedValueOnce({ uno: 'X', headline: 'H', lang: 'fr', genre: 'news', published: '2026-01-01T00:00:00Z', news: ['body'] });
      const result = await client.callTool({ name: 'afp_get_article', arguments: { uno: 'X' } });
      const text = getText(result);
      expect(text).not.toContain('**Status:**');
      expect(text).not.toContain('**Country:**');
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

    it('returns json with total and documents array', async () => {
      const result = await client.callTool({ name: 'afp_find_similar', arguments: { uno: 'AFP-TEST-001', lang: 'fr', format: 'json' } });
      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse(getText(result));
      expect(parsed.total).toBe(2);
      expect(parsed.documents).toHaveLength(2);
      expect(parsed.documents[0]).not.toHaveProperty('news');
    });

    it('returns csv with header and data rows', async () => {
      const result = await client.callTool({ name: 'afp_find_similar', arguments: { uno: 'AFP-TEST-001', lang: 'fr', format: 'csv' } });
      const lines = getText(result).split('\n');
      expect(lines[0]).toBe('uno,headline,lang,genre');
      expect(lines).toHaveLength(3); // header + 2 docs
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

      const [facet, params] = apicore.list.mock.calls.at(-1)!;
      expect(facet).toBe('slug');
      expect(params).toMatchObject({ langs: ['fr'], product: ['news'], dateFrom: 'now-1d' });
    });

    it('returns isError on API failure', async () => {
      apicore.list.mockRejectedValueOnce(new Error('Service unavailable'));
      const result = await client.callTool({ name: 'afp_list_facets', arguments: { facet: 'slug' } });
      expect(result.isError).toBe(true);
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('Service unavailable');
    });

    it('returns json array of {name, count}', async () => {
      const result = await client.callTool({ name: 'afp_list_facets', arguments: { facet: 'slug', format: 'json' } });
      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse(getText(result));
      expect(parsed).toEqual([{ name: 'economy', count: 42 }]);
    });

    it('returns csv with name,count rows', async () => {
      const result = await client.callTool({ name: 'afp_list_facets', arguments: { facet: 'slug', format: 'csv' } });
      const text = getText(result);
      expect(text).toBe('name,count\neconomy,42');
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
