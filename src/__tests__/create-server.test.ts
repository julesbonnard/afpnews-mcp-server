import { describe, expect, it, mock } from 'bun:test';
import * as actualApi from 'afpnews-api';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { buildServer } from '../mcp-server.js';

// Each test below calls mock.module('afpnews-api', ...) then `await import('../mcp-server.js')`
// again — worth flagging since ESM module identity is normally cached per resolved URL, which
// could make later tests silently exercise the first test's ApiCore mock instead of their own.
// Verified this isn't the case: Bun's mock.module() does force re-evaluation of the dependent
// module on each subsequent dynamic import (confirmed with a standalone repro outside this file).
describe('createServer', () => {
  it('authenticates with provided credentials', async () => {
    const authenticateMock = mock().mockResolvedValue(undefined);

    mock.module('afpnews-api', () => ({
      ...actualApi,
      ApiCore: class {
        token?: unknown;
        config?: unknown;
        constructor(config?: unknown) { this.config = config; }
        authenticate = authenticateMock;
      },
    }));

    const { createServer } = await import('../mcp-server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });

    expect(authenticateMock).toHaveBeenCalledWith({ username: 'user', password: 'pass' });
    mock.restore();
  });

  it('passes baseUrl to ApiCore when provided', async () => {
    let capturedConfig: unknown;
    mock.module('afpnews-api', () => ({
      ...actualApi,
      ApiCore: class {
        token?: unknown;
        constructor(config?: unknown) { capturedConfig = config; }
        authenticate = mock().mockResolvedValue(undefined);
      },
    }));

    const { createServer } = await import('../mcp-server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass', baseUrl: 'https://custom.api.com' });

    expect(capturedConfig).toEqual({ apiKey: 'api-key', baseUrl: 'https://custom.api.com' });
    mock.restore();
  });

  it('does not set baseUrl on ApiCore when omitted', async () => {
    let capturedConfig: unknown;
    mock.module('afpnews-api', () => ({
      ...actualApi,
      ApiCore: class {
        token?: unknown;
        constructor(config?: unknown) { capturedConfig = config; }
        authenticate = mock().mockResolvedValue(undefined);
      },
    }));

    const { createServer } = await import('../mcp-server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });

    expect(capturedConfig).not.toHaveProperty('baseUrl');
    mock.restore();
  });

  it('throws on missing credentials', async () => {
    mock.module('afpnews-api', () => ({
      ...actualApi,
      ApiCore: class {
        token?: unknown;
        constructor() {}
        authenticate = mock().mockResolvedValue(undefined);
      },
    }));

    const { createServer } = await import('../mcp-server.js');
    await expect(
      createServer({ apiKey: 'api-key', username: 'user', password: '' }),
    ).rejects.toThrow('Missing authentication');
    mock.restore();
  });
});

async function connectedClient(apicore: Parameters<typeof buildServer>[0]) {
  const server = buildServer(apicore);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

// Reachable via a real Client, including its input validation — not just registered.
describe('buildServer', () => {
  it('builds a reachable server around the given ApiCore without touching authentication', async () => {
    const apicore = {
      search: mock().mockResolvedValue({ documents: [], count: 0 }),
    } as unknown as Parameters<typeof buildServer>[0];
    const client = await connectedClient(apicore);

    const result = await client.callTool({ name: 'afp_search_articles', arguments: { query: 'test' } });

    expect(result.isError).toBeFalsy();
    expect(apicore.search).toHaveBeenCalled();
  });

  it('rejects invalid args before the tool handler runs', async () => {
    const apicore = {
      search: mock().mockResolvedValue({ documents: [], count: 0 }),
    } as unknown as Parameters<typeof buildServer>[0];
    const client = await connectedClient(apicore);

    const result = await client.callTool({ name: 'afp_search_articles', arguments: { fields: ['notARealField'] } });

    expect(result.isError).toBe(true);
    expect(apicore.search).not.toHaveBeenCalled();
  });

  // Equivalent of definitions.test.ts's old exact-name-list guard, now that TOOL_DEFINITIONS
  // is gone — via the real protocol instead of a static metadata export.
  it('lists exactly the expected tools', async () => {
    const client = await connectedClient({} as Parameters<typeof buildServer>[0]);

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).slice().sort()).toEqual(
      [
        'afp_search_articles',
        'afp_get_article',
        'afp_find_similar',
        'afp_list_facets',
        'afp_search_media',
        'afp_get_media',
      ].slice().sort(),
    );
  });
});
