import { describe, expect, it, mock } from 'bun:test';
import * as actualApi from 'afpnews-api';

process.env.APICORE_API_KEY = 'test-key';
process.env.APICORE_BASE_URL = 'https://fake.api.afp.com';
process.env.JWT_SECRET = 'a-very-long-test-secret-of-32-chars-min';
process.env.MCP_SERVER_URL = 'http://localhost:4180';
process.env.MCP_TRANSPORT = 'http';
process.env.PORT = '4180';

const base = 'http://localhost:4180';

// Coverage for the Hono-specific wiring: the official
// @modelcontextprotocol/hono originValidation middleware and the
// metadata/404 routing — none of which is exercised by oauth-flow.test.ts.
// Rate limiting is left to the hosting platform (e.g. Cloudflare) rather
// than a hand-rolled in-process counter, so there's nothing to test here.
// A single test, like oauth-flow.test.ts: startHttpServer() binds a real
// port that isn't torn down, so a second call in the same file would fail.
describe('HTTP server (Hono)', () => {
  it('serves health/metadata, 404s unknown well-known paths, rejects a disallowed Origin on /mcp', async () => {
    mock.module('afpnews-api', () => ({ ...actualApi, ApiCore: class { token?: unknown; constructor() {} } }));
    const { startHttpServer } = await import('../http/server.js');
    await startHttpServer();
    await new Promise((r) => setTimeout(r, 200));

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });

    const prm = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    expect(prm.status).toBe(200);
    expect((await prm.json()).resource).toBe(`${base}/mcp`);

    const authServer = await fetch(`${base}/.well-known/oauth-authorization-server`);
    expect(authServer.status).toBe(200);

    const unknown = await fetch(`${base}/.well-known/nope`);
    expect(unknown.status).toBe(404);

    const badOrigin = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(badOrigin.status).toBe(403);

    mock.restore();
  });
});
