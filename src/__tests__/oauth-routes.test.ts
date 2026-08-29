import { describe, expect, it, mock } from 'bun:test';
import * as actualApi from 'afpnews-api';

process.env.APICORE_API_KEY = 'test-key';
process.env.APICORE_BASE_URL = 'https://fake.api.afp.com';
process.env.JWT_SECRET = 'a-very-long-test-secret-of-32-chars-min';
process.env.MCP_SERVER_URL = 'http://localhost:4181';
process.env.MCP_TRANSPORT = 'http';
process.env.PORT = '4181';
process.env.MCP_ALLOWED_REDIRECT_URIS = 'https://claude.ai/api/mcp/auth_callback';

const base = 'http://localhost:4181';
const redirectUri = 'https://claude.ai/api/mcp/auth_callback';

// Coverage for the OAuth HTTP routes not exercised by oauth-flow.test.ts (the PKCE code-exchange
// flow) or http-server.test.ts (Hono wiring/metadata/origin validation): dynamic client
// registration, the login page GET route (including its error branches), and the
// grant_type=afp_credentials error paths. Single test, real port, like the other two http/*
// test files — startHttpServer() binds a port that isn't torn down.
describe('OAuth HTTP routes', () => {
  it('covers /oauth/register, GET /oauth/authorize, and afp_credentials error branches', async () => {
    mock.module('afpnews-api', () => ({
      ...actualApi,
      ApiCore: class {
        token?: unknown;
        constructor() {}
        authenticate = mock().mockRejectedValue(new Error('invalid credentials')); // exercised below
      },
    }));

    const { startHttpServer } = await import('../http/server.js');
    await startHttpServer();
    await new Promise((r) => setTimeout(r, 200));

    // POST /oauth/register — dynamic client registration (RFC 7591-ish, no real persistence).
    const registerRes = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [redirectUri] }),
    });
    expect(registerRes.status).toBe(201);
    const registered = await registerRes.json();
    expect(registered.client_id).toBe(base);
    expect(registered.redirect_uris).toEqual([redirectUri]);
    expect(registered.token_endpoint_auth_method).toBe('none');

    // POST /oauth/register with an unparseable body: redirect_uris defaults to [], no crash.
    const registerNoBodyRes = await fetch(`${base}/oauth/register`, { method: 'POST' });
    expect(registerNoBodyRes.status).toBe(201);
    expect((await registerNoBodyRes.json()).redirect_uris).toEqual([]);

    // GET /oauth/authorize — missing required params.
    const missingParamsRes = await fetch(`${base}/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`);
    expect(missingParamsRes.status).toBe(400);

    // GET /oauth/authorize — redirect_uri not in the allowlist (and not localhost).
    const disallowedRes = await fetch(
      `${base}/oauth/authorize?redirect_uri=${encodeURIComponent('https://evil.example.com/callback')}&code_challenge=chall`,
    );
    expect(disallowedRes.status).toBe(400);
    expect(await disallowedRes.text()).toContain('not in the allowed list');

    // GET /oauth/authorize — valid request renders the login page with CSP/X-Frame-Options
    // headers and embeds the query params for the page's own JS to read back.
    const authorizeRes = await fetch(
      `${base}/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=chall123&state=xyz`,
    );
    expect(authorizeRes.status).toBe(200);
    const csp = authorizeRes.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'nonce-[^']+'/); // no 'unsafe-inline' for scripts
    expect(authorizeRes.headers.get('x-frame-options')).toBe('DENY');
    const html = await authorizeRes.text();
    expect(html).toContain('AFP News MCP');
    expect(html).toContain(`data-redirect-uri="${redirectUri}"`);
    expect(html).toContain('data-code-challenge="chall123"');

    // POST /oauth/token grant_type=afp_credentials — missing required fields.
    const missingCredsRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'afp_credentials', username: 'jdoe' }),
    });
    expect(missingCredsRes.status).toBe(400);
    expect((await missingCredsRes.json()).error).toBe('invalid_request');

    // POST /oauth/token grant_type=afp_credentials — redirect_uri not allowed.
    const disallowedCredsRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'afp_credentials',
        username: 'jdoe',
        password: 'pw',
        redirect_uri: 'https://evil.example.com/callback',
        code_challenge: 'chall',
      }),
    });
    expect(disallowedCredsRes.status).toBe(400);
    expect((await disallowedCredsRes.json()).error).toBe('invalid_request');

    // POST /oauth/token grant_type=afp_credentials — AFP rejects the credentials.
    const badCredsRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'afp_credentials',
        username: 'jdoe',
        password: 'wrong',
        redirect_uri: redirectUri,
        code_challenge: 'chall',
      }),
    });
    expect(badCredsRes.status).toBe(401);
    expect((await badCredsRes.json()).error).toBe('invalid_grant');

    // POST /oauth/token — a body Hono's parseBody() actually throws on (malformed multipart:
    // a boundary declared in the content-type but absent from the body), exercising the
    // parseTokenRequestBody catch branch. A bare unlabeled body just parses to {} rather than
    // throwing, so it wouldn't reach this branch.
    const invalidBodyRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=xyz' },
      body: 'garbage-not-multipart',
    });
    expect(invalidBodyRes.status).toBe(400);
    expect((await invalidBodyRes.json()).error).toBe('invalid_request');

    // POST /oauth/token grant_type=authorization_code — missing required fields.
    const missingCodeFieldsRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: 'x' }),
    });
    expect(missingCodeFieldsRes.status).toBe(400);
    expect((await missingCodeFieldsRes.json()).error).toBe('invalid_request');

    mock.restore();
  });
});
