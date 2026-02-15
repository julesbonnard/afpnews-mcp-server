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

  describe('search tool', () => {
    it('returns markdown with UNO and title', async () => {
      const result = await client.callTool({ name: 'search', arguments: { query: 'test' } });
      expect(result.content).toHaveLength(3);
      const first = result.content![0] as { type: string; text: string };
      expect(first.type).toBe('text');
      expect(first.text).toContain('## Article 1');
      expect(first.text).toContain('UNO: AFP-TEST-001');
    });

    it('returns text message on empty results', async () => {
      apicore.search.mockResolvedValueOnce({ documents: [], count: 0 });
      const result = await client.callTool({ name: 'search', arguments: { query: 'nothing' } });
      expect(result.content).toHaveLength(1);
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toBe('No results found.');
    });

    it('returns excerpt by default (no fullText)', async () => {
      apicore.search.mockResolvedValueOnce({ documents: [FIXTURE_DOC], count: 1 });
      const result = await client.callTool({ name: 'search', arguments: { query: 'test' } });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('Fourth paragraph wraps up.');
      expect(msg.text).not.toContain('Fifth paragraph is extra content.');
    });

    it('returns full text when fullText=true', async () => {
      apicore.search.mockResolvedValueOnce({ documents: [FIXTURE_DOC], count: 1 });
      const result = await client.callTool({ name: 'search', arguments: { query: 'test', fullText: true } });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('Fifth paragraph is extra content.');
    });

    it('preset a-la-une applies filters and defaults to full text', async () => {
      apicore.search.mockResolvedValueOnce({ documents: [FIXTURE_DOC], count: 1 });
      const result = await client.callTool({ name: 'search', arguments: { preset: 'a-la-une' } });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toContain('Fifth paragraph is extra content.');

      const [request] = apicore.search.mock.calls.at(-1)!;
      expect(request.product).toEqual(['news']);
      expect(request.lang).toEqual(['fr']);
      expect(request.slug).toEqual(['afp', 'actualites']);
      expect(request.dateFrom).toBe('now-1d');
      expect(request.size).toBe(1);
    });
  });

  describe('get tool', () => {
    it('returns full document with fullText', async () => {
      const result = await client.callTool({ name: 'get', arguments: { uno: 'AFP-TEST-001' } });
      expect(result.content).toHaveLength(1);
      const doc = result.content![0] as { type: string; text: string };
      expect(doc.type).toBe('text');
      expect(doc.text).toContain('## Article 1');
    });
  });

  describe('mlt tool', () => {
    it('returns formatted similar documents', async () => {
      const result = await client.callTool({ name: 'mlt', arguments: { uno: 'AFP-TEST-001', lang: 'fr' } });
      expect(result.content).toHaveLength(2);
      const first = result.content![0] as { type: string; text: string };
      expect(first.text).toContain('UNO:');
    });

    it('returns text message on empty results', async () => {
      apicore.mlt.mockResolvedValueOnce({ documents: [], count: 0 });
      const result = await client.callTool({ name: 'mlt', arguments: { uno: 'AFP-TEST-001', lang: 'fr' } });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toBe('No similar articles found.');
    });
  });

  describe('list tool', () => {
    it('returns JSON', async () => {
      const result = await client.callTool({ name: 'list', arguments: { facet: 'slug' } });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.type).toBe('text');
      const parsed = JSON.parse(msg.text);
      expect(parsed[0].key).toBe('economy');
    });

    it('returns a validation message when facet is missing without preset', async () => {
      const result = await client.callTool({ name: 'list', arguments: {} });
      const msg = result.content![0] as { type: string; text: string };
      expect(msg.text).toBe('Missing required parameter: facet (or provide preset: trending-topics).');
    });

    it('preset trending-topics applies list overrides', async () => {
      const result = await client.callTool({ name: 'list', arguments: { preset: 'trending-topics' } });
      const msg = result.content![0] as { type: string; text: string };
      const parsed = JSON.parse(msg.text);
      expect(parsed[0].key).toBe('economy');

      const [facet, params, limit] = apicore.list.mock.calls.at(-1)!;
      expect(facet).toBe('slug');
      expect(params).toMatchObject({ langs: ['fr'], product: ['news'], dateFrom: 'now-1d' });
      expect(limit).toBe(20);
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
    it('daily-briefing returns user message', async () => {
      const result = await client.getPrompt({ name: 'daily-briefing', arguments: {} });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).toContain('search');
    });

    it('country-news returns user message with country', async () => {
      const result = await client.getPrompt({ name: 'country-news', arguments: { country: 'fra' } });
      expect(result.messages).toHaveLength(1);
      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).toContain('fra');
    });
  });
});
