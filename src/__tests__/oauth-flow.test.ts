import { describe, expect, it, mock } from 'bun:test';
import { createHash } from 'node:crypto';
import { EncryptJWT } from 'jose';
import * as actualApi from 'afpnews-api';
import { deriveKey } from '../http/tokens.js';

process.env.APICORE_API_KEY = 'test-key';
process.env.APICORE_BASE_URL = 'https://fake.api.afp.com';
process.env.JWT_SECRET = 'a-very-long-test-secret-of-32-chars-min';
process.env.MCP_SERVER_URL = 'http://localhost:4179';
process.env.MCP_TRANSPORT = 'http';
process.env.PORT = '4179';
process.env.MCP_ALLOWED_REDIRECT_URIS = 'https://claude.ai/api/mcp/auth_callback';

const base = 'http://localhost:4179';
const redirectUri = 'https://claude.ai/api/mcp/auth_callback';

// End-to-end coverage of the OAuth2 PKCE code flow, exercising the
// self-contained authorization code (no server-side state at all — see
// tokens.ts): minting, exchange, PKCE verification, expiry, and the
// resulting bearer token authenticating /mcp.
describe('OAuth2 PKCE code flow', () => {
  it('mints a code, exchanges it, rejects wrong PKCE and expired codes, and authenticates /mcp', async () => {
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

    // RFC 6749 §4.1.3: the token endpoint takes application/x-www-form-urlencoded
    // (what real OAuth2 clients like MCP Inspector and Claude.ai send).
    const mintCode = async () => {
      const res = await fetch(`${base}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
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
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }),
      });

    const code = await mintCode();

    const exchangeRes = await exchangeCode(code, codeVerifier);
    expect(exchangeRes.status).toBe(200);
    const tokens = await exchangeRes.json();
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    // Deliberate trade-off (no server-side state — see tokens.ts): the same
    // still-valid code CAN be exchanged again. Only its short TTL bounds
    // replay, not single-use enforcement.
    const replayRes = await exchangeCode(code, codeVerifier);
    expect(replayRes.status).toBe(200);

    // Fresh code, wrong verifier — PKCE enforcement.
    const code2 = await mintCode();
    const badVerifierRes = await exchangeCode(code2, 'wrong-verifier');
    expect(badVerifierRes.status).toBe(400);

    // An expired code (crafted directly, rather than waiting out the real
    // TTL) is rejected.
    const authCodeKey = await deriveKey(process.env.JWT_SECRET!, 'auth-code');
    const expiredCode = await new EncryptJWT({
      u: 'jdoe', at: 'access', rt: 'refresh', texp: Date.now() + 60_000,
      aud: `${base}/mcp`, cc: codeChallenge, ru: redirectUri,
    })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt()
      .setExpirationTime('-1s')
      .encrypt(authCodeKey);
    const expiredRes = await exchangeCode(expiredCode, codeVerifier);
    expect(expiredRes.status).toBe(400);
    expect((await expiredRes.json()).error).toBe('invalid_grant');

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
