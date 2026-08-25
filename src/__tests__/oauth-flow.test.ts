import { describe, expect, it, mock } from 'bun:test';
import { createHash } from 'node:crypto';
import * as actualApi from 'afpnews-api';

process.env.APICORE_API_KEY = 'test-key';
process.env.APICORE_BASE_URL = 'https://fake.api.afp.com';
process.env.JWT_SECRET = 'a-very-long-test-secret-of-32-chars-min';
process.env.MCP_SERVER_URL = 'http://localhost:4179';
process.env.MCP_TRANSPORT = 'http';
process.env.PORT = '4179';

const base = 'http://localhost:4179';
const redirectUri = 'https://claude.ai/api/mcp/auth_callback';

// End-to-end coverage of the OAuth2 PKCE code flow, exercising the
// self-contained authorization code (no server-side payload store — see
// tokens.ts) end to end: minting, exchange, single-use enforcement, PKCE
// verification, and the resulting bearer token authenticating /mcp.
describe('OAuth2 PKCE code flow', () => {
  it('mints a code, exchanges it once, rejects replay and wrong PKCE, and authenticates /mcp', async () => {
    mock.module('afpnews-api', () => ({
      ...actualApi,
      ApiCore: class {
        token?: unknown;
        constructor() {}
        authenticate = mock().mockResolvedValue({
          accessToken: 'afp-access-token',
          refreshToken: 'afp-refresh-token',
          tokenExpires: Date.now() + 3600_000,
        });
      },
    }));

    const { startHttpServer } = await import('../http/server.js');
    await startHttpServer();
    await new Promise((r) => setTimeout(r, 200));

    const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const mintCode = async () => {
      const res = await fetch(`${base}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'afp_credentials',
          username: 'jdoe',
          password: 'whatever',
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
        }),
      });
      expect(res.status).toBe(200);
      return (await res.json()).code as string;
    };

    const exchangeCode = (code: string, verifier: string) =>
      fetch(`${base}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }),
      });

    const code = await mintCode();

    const exchangeRes = await exchangeCode(code, codeVerifier);
    expect(exchangeRes.status).toBe(200);
    const tokens = await exchangeRes.json();
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    // Same code used twice — single-use enforcement.
    const replayRes = await exchangeCode(code, codeVerifier);
    expect(replayRes.status).toBe(400);
    expect((await replayRes.json()).error).toBe('invalid_grant');

    // Fresh code, wrong verifier — PKCE enforcement.
    const code2 = await mintCode();
    const badVerifierRes = await exchangeCode(code2, 'wrong-verifier');
    expect(badVerifierRes.status).toBe(400);

    // The minted access token authenticates a real /mcp call.
    const mcpRes = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${tokens.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(mcpRes.status).toBe(200);
    expect(await mcpRes.text()).toContain('afp_search_articles');

    mock.restore();
  });
});
