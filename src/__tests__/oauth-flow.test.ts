import { describe, expect, it, mock } from 'bun:test';
import { createHash } from 'node:crypto';
import { EncryptJWT } from 'jose';
import * as actualApi from 'afpnews-api';
import { deriveKey, encryptAfpToken, encryptAfpRefreshToken } from '../http/tokens.js';

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
        token?: { refreshToken?: string };
        constructor() {}
        // Rejects only for the sentinel refresh token crafted below (AFP refusing an
        // otherwise-well-formed refresh) — every other call keeps resolving normally.
        authenticate = mock(async function (this: { token?: { refreshToken?: string } }) {
          if (this.token?.refreshToken === 'afp-refresh-token-afp-rejects') {
            throw new Error('AFP rejected the refresh token');
          }
          return {
            accessToken: 'afp-access-token',
            refreshToken: 'afp-refresh-token',
            tokenExpires: Date.now() + 3600_000,
          };
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

    // Fresh code, correct verifier, but a redirect_uri that doesn't match the one the code
    // was minted for.
    const code3 = await mintCode();
    const mismatchRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code3,
        code_verifier: codeVerifier,
        redirect_uri: 'http://localhost:9/different-callback',
      }),
    });
    expect(mismatchRes.status).toBe(400);
    expect((await mismatchRes.json()).error_description).toContain('redirect_uri mismatch');

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

    // A well-formed, non-expired access token whose `aud` was minted for a different resource
    // server (RFC 8707 resource indicator binding) is rejected rather than accepted just because
    // it decrypts and shares the same JWT_SECRET.
    const accessKey = await deriveKey(process.env.JWT_SECRET!, 'access-token');
    const wrongAudienceToken = await encryptAfpToken(accessKey, {
      at: 'afp-access-token', rt: 'afp-refresh-token', exp: Date.now() + 3600_000, u: 'jdoe',
      aud: 'http://localhost:9999/mcp',
    });
    const wrongAudienceRes = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${wrongAudienceToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(wrongAudienceRes.status).toBe(401);

    // grant_type=refresh_token where the refresh_token itself decrypts fine, but AFP then
    // refuses the refresh (e.g. it was revoked upstream) — distinct from the "undecryptable
    // token" branch covered by badRefreshRes below.
    const refreshKey = await deriveKey(process.env.JWT_SECRET!, 'refresh-token');
    const afpRejectedRefreshToken = await encryptAfpRefreshToken(refreshKey, 'afp-refresh-token-afp-rejects', 'jdoe');
    const afpRejectsRefreshRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: afpRejectedRefreshToken }),
    });
    expect(afpRejectsRefreshRes.status).toBe(401);
    expect((await afpRejectsRefreshRes.json()).error_description).toContain('Refresh token expired');

    // grant_type=refresh_token: mint a fresh access/refresh token pair from the refresh_token
    // returned by the authorization_code exchange above.
    const refreshRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });
    expect(refreshRes.status).toBe(200);
    const refreshed = await refreshRes.json();
    expect(refreshed.access_token).toBeTruthy();
    expect(refreshed.refresh_token).toBeTruthy();

    // The newly minted access token authenticates /mcp too.
    const mcpAfterRefreshRes = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${refreshed.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(mcpAfterRefreshRes.status).toBe(200);

    // An unparseable/garbage refresh_token is rejected rather than crashing the endpoint.
    const badRefreshRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'not-a-valid-token' }),
    });
    expect(badRefreshRes.status).toBe(401);
    expect((await badRefreshRes.json()).error).toBe('invalid_grant');

    // Missing refresh_token entirely.
    const missingRefreshRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token' }),
    });
    expect(missingRefreshRes.status).toBe(400);
    expect((await missingRefreshRes.json()).error).toBe('invalid_request');

    // Unknown grant_type.
    const unsupportedRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    expect(unsupportedRes.status).toBe(400);
    expect((await unsupportedRes.json()).error).toBe('unsupported_grant_type');

    mock.restore();
  });
});
