import { Hono, type Context } from 'hono';
import { originValidation } from '@modelcontextprotocol/hono';
import {
  createMcpHandler,
  requireBearerAuth,
  oauthMetadataResponse,
  getOAuthProtectedResourceMetadataUrl,
  checkResourceAllowed,
  localhostAllowedOrigins,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  type OAuthMetadata,
  type AuthMetadataOptions,
  type McpRequestContext,
} from '@modelcontextprotocol/server';
import { createServer, type AfpAuthToken } from '../mcp-server.js';
import {
  deriveKey,
  sha256Base64Url,
  encryptAfpToken,
  decryptAfpToken,
  encryptAfpRefreshToken,
  decryptAfpRefreshToken,
  encryptAuthCode,
  decryptAuthCode,
} from './tokens.js';
import { buildLoginPage, buildAllowedUris, isAllowedRedirectUri } from './login-page.js';
import { ApiCore } from 'afpnews-api';

export type HttpConfig = {
  apiKey: string;
  afpBaseUrl: string | undefined;
  jwtSecret: string;
  serverUrl: string;
  port: number;
  allowedUris: string[];
};

// The only function that touches raw environment variables. `env` defaults
// to `process.env` (Bun) but takes a plain object so the same function
// works from a Cloudflare Worker's `env` binding — see src/http/worker.ts.
// Everything below this point (createHttpApp) only ever reads from the
// returned HttpConfig, never from `process.env`/`env` directly.
export function resolveHttpConfig(env: Record<string, string | undefined> = process.env): HttpConfig {
  const apiKey = env.APICORE_API_KEY?.trim();
  if (!apiKey) throw new Error('APICORE_API_KEY environment variable is required');

  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');

  const serverUrl = env.MCP_SERVER_URL?.replace(/\/$/, '');
  if (!serverUrl) throw new Error('MCP_SERVER_URL is required in HTTP mode (e.g. https://news-mcp.example.com)');

  const port = parseInt(env.PORT || '3000', 10);
  if (isNaN(port) || port <= 0) throw new Error('PORT must be a positive integer');

  const afpBaseUrl = env.APICORE_BASE_URL?.trim();
  if (!afpBaseUrl) throw new Error('APICORE_BASE_URL environment variable is required');

  const allowedUris = buildAllowedUris(env);

  return { apiKey, afpBaseUrl, jwtSecret, serverUrl, port, allowedUris };
}

// Rate limiting (elysia-rate-limit in the previous Elysia version) is left
// to the hosting platform — e.g. Cloudflare's own Rate Limiting — rather
// than a hand-rolled in-process counter, which would be per-isolate-only
// and thus pointless on an edge deployment anyway.

// Builds the Hono app from an already-resolved config. Platform-agnostic —
// no `process.env`, no `Bun.*` — so it's shared verbatim between
// startHttpServer() (Bun) and worker.ts (Cloudflare Workers).
export async function createHttpApp(config: HttpConfig) {
  const { apiKey, afpBaseUrl, jwtSecret, serverUrl, allowedUris } = config;

  console.debug(`Allowed redirect URIs: localhost/* + ${allowedUris.filter(u => !u.includes('localhost')).join(', ')}`);

  const accessKey = await deriveKey(jwtSecret, 'access-token');
  const refreshKey = await deriveKey(jwtSecret, 'refresh-token');
  const authCodeKey = await deriveKey(jwtSecret, 'auth-code');

  // The `/mcp` endpoint is this server's only protected resource (RFC 8707 /
  // RFC 9728) — every issued token is bound to it via the `aud` claim.
  const resourceUrl = new URL(`${serverUrl}/mcp`);
  const protectedResourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);

  const oauthMetadata: OAuthMetadata = {
    issuer: serverUrl,
    authorization_endpoint: `${serverUrl}/oauth/authorize`,
    token_endpoint: `${serverUrl}/oauth/token`,
    registration_endpoint: `${serverUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
  const authMetadataOptions: AuthMetadataOptions = {
    oauthMetadata,
    resourceServerUrl: resourceUrl,
    resourceName: 'AFP News MCP',
  };

  // The authorization code is a self-contained JWE (see tokens.ts) with no
  // backing server-side state at all — not even a "consumed" marker, so
  // this server can run with zero infrastructure (e.g. a Cloudflare Worker
  // with no KV/Redis). There is no single-use enforcement: its short TTL
  // is the only thing bounding a replay window. See the comment on
  // AuthCodePayload in tokens.ts for the full trade-off.

  const makeAfpClient = () => new ApiCore({ baseUrl: afpBaseUrl, apiKey });

  const mintTokenResponse = async (afpToken: AfpAuthToken, username: string) => {
    const accessToken = await encryptAfpToken(accessKey, {
      at: afpToken.accessToken,
      rt: afpToken.refreshToken,
      exp: afpToken.tokenExpires,
      u: username,
      aud: resourceUrl.toString(),
    });
    const refreshToken = await encryptAfpRefreshToken(refreshKey, afpToken.refreshToken, username);
    const expiresIn = Math.max(60, Math.floor((afpToken.tokenExpires - Date.now()) / 1000));
    return { access_token: accessToken, token_type: 'bearer', expires_in: expiresIn, refresh_token: refreshToken };
  };

  // Resource Server verifier: our own AFP-token JWE doubles as the MCP
  // bearer token, so verification is decryption + audience binding rather
  // than introspection against a separate Authorization Server.
  const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
      const payload = await decryptAfpToken(accessKey, token).catch(() => null);
      if (!payload) throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid or expired token');
      if (!payload.aud || !checkResourceAllowed({ requestedResource: payload.aud, configuredResource: resourceUrl })) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Token was not issued for this resource');
      }
      return {
        token,
        clientId: payload.u,
        scopes: [],
        expiresAt: Math.floor(payload.exp / 1000),
        resource: resourceUrl,
        extra: { accessToken: payload.at, refreshToken: payload.rt },
      };
    },
  };
  const authGate = requireBearerAuth({ verifier, resourceMetadataUrl: protectedResourceMetadataUrl });
  const mcpOriginHostnames = [resourceUrl.hostname, ...localhostAllowedOrigins()];

  // Stateless per-request serving (spec 2026-07-28): a fresh McpServer is
  // built from the request's own bearer token, so no session store is
  // needed and any instance behind a load balancer can serve any request.
  const mcpHandler = createMcpHandler(
    async (ctx: McpRequestContext) => {
      const extra = ctx.authInfo?.extra as { accessToken: string; refreshToken: string } | undefined;
      if (!extra) throw new Error('Missing AFP auth context');
      return createServer({
        apiKey,
        baseUrl: afpBaseUrl,
        authToken: {
          accessToken: extra.accessToken,
          refreshToken: extra.refreshToken,
          tokenExpires: (ctx.authInfo?.expiresAt ?? 0) * 1000,
        },
      });
    },
    { legacy: 'stateless', onerror: (error) => console.error('MCP handler error:', error) },
  );

  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok' }));

  const wellKnown = (c: Context) => oauthMetadataResponse(c.req.raw, authMetadataOptions) ?? c.notFound();
  app.get('/.well-known/oauth-authorization-server', wellKnown);
  app.get('/.well-known/oauth-protected-resource/mcp', wellKnown);
  app.options('/.well-known/oauth-authorization-server', wellKnown);
  app.options('/.well-known/oauth-protected-resource/mcp', wellKnown);

  app.post('/oauth/register', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json({
      client_id: serverUrl,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: Array.isArray(body?.redirect_uris) ? body.redirect_uris : [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, 201);
  });

  app.get('/oauth/authorize', (c) => {
    const redirect_uri = c.req.query('redirect_uri');
    const code_challenge = c.req.query('code_challenge');
    const state = c.req.query('state');
    const client_id = c.req.query('client_id');
    if (!redirect_uri || !code_challenge) {
      return c.text('Missing required OAuth2 parameters', 400);
    }
    if (!isAllowedRedirectUri(redirect_uri, allowedUris)) {
      return c.text('Invalid redirect_uri: not in the allowed list', 400);
    }
    return c.html(buildLoginPage({ redirectUri: redirect_uri, codeChallenge: code_challenge, state, clientId: client_id }), 200, {
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  // RFC 6749 §4.1.3/§6: the token endpoint takes application/x-www-form-urlencoded.
  // Our own login page (login-page.ts) posts the afp_credentials grant the
  // same way, so this is the only format the route needs to handle.
  const parseTokenRequestBody = async (c: Context): Promise<Record<string, any> | null> => {
    try {
      return await c.req.parseBody();
    } catch {
      return null;
    }
  };

  app.post('/oauth/token', async (c) => {
    const body = await parseTokenRequestBody(c);
    if (!body) {
      return c.json({ error: 'invalid_request', error_description: 'Invalid request body' }, 400);
    }
    const { grant_type } = body;

    if (grant_type === 'afp_credentials') {
      const { username: reqUsername, password: reqPassword, redirect_uri, code_challenge } = body;
      if (!reqUsername || !reqPassword || !redirect_uri || !code_challenge) {
        return c.json({ error: 'invalid_request', error_description: 'Missing required fields' }, 400);
      }
      if (!isAllowedRedirectUri(redirect_uri, allowedUris)) {
        return c.json({ error: 'invalid_request', error_description: 'Invalid redirect_uri' }, 400);
      }
      let afpToken: AfpAuthToken;
      try {
        afpToken = await makeAfpClient().authenticate({ username: reqUsername, password: reqPassword });
      } catch {
        return c.json({ error: 'invalid_grant', error_description: 'Identifiants AFP invalides' }, 401);
      }
      const code = await encryptAuthCode(authCodeKey, {
        u: reqUsername,
        at: afpToken.accessToken,
        rt: afpToken.refreshToken,
        exp: afpToken.tokenExpires,
        aud: resourceUrl.toString(),
        codeChallenge: code_challenge,
        redirectUri: redirect_uri,
      });
      return c.json({ code });
    }

    if (grant_type === 'authorization_code') {
      const { code, code_verifier, redirect_uri } = body;
      if (!code || !code_verifier || !redirect_uri) {
        return c.json({ error: 'invalid_request', error_description: 'Missing code, code_verifier or redirect_uri' }, 400);
      }
      let authCode: Awaited<ReturnType<typeof decryptAuthCode>>;
      try {
        authCode = await decryptAuthCode(authCodeKey, code);
      } catch {
        return c.json({ error: 'invalid_grant', error_description: 'Auth code expired or invalid' }, 400);
      }
      const expectedChallenge = await sha256Base64Url(code_verifier);
      if (expectedChallenge !== authCode.codeChallenge) {
        return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
      }
      if (authCode.redirectUri !== redirect_uri) {
        return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
      }

      return c.json(await mintTokenResponse(
        { accessToken: authCode.at, refreshToken: authCode.rt, tokenExpires: authCode.exp },
        authCode.u,
      ));
    }

    if (grant_type === 'refresh_token') {
      const { refresh_token } = body;
      if (!refresh_token) {
        return c.json({ error: 'invalid_request', error_description: 'Missing refresh_token' }, 400);
      }
      let afpRefreshToken: string;
      let username: string;
      try {
        ({ afpRefreshToken, username } = await decryptAfpRefreshToken(refreshKey, refresh_token));
      } catch {
        return c.json({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, 401);
      }
      try {
        const client = makeAfpClient();
        client.token = { accessToken: '', refreshToken: afpRefreshToken, tokenExpires: 0, authType: 'credentials' };
        const newAfpToken: AfpAuthToken = await client.authenticate();
        return c.json(await mintTokenResponse(newAfpToken, username));
      } catch {
        return c.json({ error: 'invalid_grant', error_description: 'Refresh token expired, please sign in again' }, 401);
      }
    }

    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  // originValidation is the official Hono adapter's equivalent of the
  // framework-neutral originValidationResponse() used before — scoped to
  // /mcp only, matching the SDK's documented createMcpHandler() mounting
  // pattern (the metadata/oauth routes above need to stay reachable
  // cross-origin for OAuth discovery). No parsedBody needed: nothing reads
  // the request body before it reaches mcpHandler.fetch.
  app.all('/mcp', originValidation(mcpOriginHostnames), async (c) => {
    const auth = await authGate(c.req.raw);
    if (auth instanceof Response) return auth;
    return mcpHandler.fetch(c.req.raw, { authInfo: auth });
  });

  return app;
}

// Bun entry point — the only Bun-specific code in this file. A Cloudflare
// Worker entry point instead builds the same app via createHttpApp() and
// exports its `fetch` directly; see src/http/worker.ts.
export async function startHttpServer() {
  const config = resolveHttpConfig();
  const app = await createHttpApp(config);
  Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(`MCP HTTP server listening on port ${config.port}`);
}
