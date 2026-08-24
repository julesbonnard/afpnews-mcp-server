import { describe, expect, it, mock } from 'bun:test';
import { PassThrough } from 'node:stream';
import * as actualApi from 'afpnews-api';

describe('stdio transport (v2 SDK)', () => {
  it('serves tools/list end-to-end over a real StdioServerTransport', async () => {
    mock.module('afpnews-api', () => ({
      ...actualApi,
      ApiCore: class {
        token?: unknown;
        constructor() {}
        authenticate = mock().mockResolvedValue(undefined);
      },
    }));

    const { StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
    const { createServer } = await import('../mcp-server.js');

    const server = await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });

    // Simulate the client side of the process's stdin/stdout pipes.
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const transport = new StdioServerTransport(clientToServer, serverToClient);
    await server.connect(transport);

    const response = await new Promise<any>((resolve) => {
      serverToClient.once('data', (chunk) => resolve(JSON.parse(chunk.toString().trim())));
      clientToServer.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n');
    });

    expect(response.id).toBe(1);
    expect(response.result.tools.map((t: { name: string }) => t.name)).toContain('afp_search_articles');

    await server.close();
    mock.restore();
  });
});
