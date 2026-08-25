import {
  createMcpHandler,
  requireBearerAuth,
  oauthMetadataResponse,
  getOAuthProtectedResourceMetadataUrl,
  checkResourceAllowed,
  originValidationResponse,
  localhostAllowedOrigins,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  type OAuthMetadata,
  type AuthMetadataOptions,
  type McpRequestContext,
} from '@modelcontextprotocol/server';
import { Elysia, t, status } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';
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

type HttpConfig = {
  apiKey: string;
  afpBaseUrl: string | undefined;
  jwtSecret: string;
  serverUrl: string;
  port: number;
};

function resolveHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
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

  return { apiKey, afpBaseUrl, jwtSecret, serverUrl, port };
}

const registerBodySchema = t.Object(
  { redirect_uris: t.Optional(t.Array(t.String())) },
  { additionalProperties: true },
);
const authorizeQuerySchema = t.Object({
  redirect_uri: t.Optional(t.String()),
  code_challenge: t.Optional(t.String()),
  state: t.Optional(t.String()),
  client_id: t.Optional(t.String()),
});
const oauthTokenBodySchema = t.Object({
  grant_type: t.String(),
  username: t.Optional(t.String()),
  password: t.Optional(t.String()),
  redirect_uri: t.Optional(t.String()),
  code_challenge: t.Optional(t.String()),
  code: t.Optional(t.String()),
  code_verifier: t.Optional(t.String()),
  refresh_token: t.Optional(t.String()),
}, { additionalProperties: true });

export async function startHttpServer() {
  const { apiKey, afpBaseUrl, jwtSecret, serverUrl, port } = resolveHttpConfig();

  const allowedUris = buildAllowedUris();
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

  // The authorization code itself is a self-contained JWE (see tokens.ts) —
  // no server-side lookup is needed to exchange it. The only state left
  // here is this tiny single-use marker: it just needs to outlive the
  // code's own TTL, and stores nothing sensitive (not even which code —
  // only its opaque ciphertext). A future multi-instance/edge deployment
  // could swap this Map for a shared "SET NX" style nonce store (Redis,
  // Cloudflare KV, DynamoDB…) without touching the rest of the OAuth flow.
  const consumedAuthCodes = new Map<string, number>();

  setInterval(() => {
    const now = Date.now();
    for (const [code, expiresAt] of consumedAuthCodes) {
      if (now > expiresAt) consumedAuthCodes.delete(code);
    }
  }, 60_000);

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

  const ipGenerator = (req: Request) =>
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';

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

  async function handleMcpRequest(request: Request, body: unknown): Promise<Response> {
    const rejected = originValidationResponse(request, mcpOriginHostnames);
    if (rejected) return rejected;

    const auth = await authGate(request);
    if (auth instanceof Response) return auth;

    return mcpHandler.fetch(request, { authInfo: auth, parsedBody: body });
  }

  new Elysia()
    .use(rateLimit({ max: 20, duration: 60_000, generator: ipGenerator }))
    .get('/health', () => ({ status: 'ok' }))
    .get('/.well-known/oauth-authorization-server', ({ request }) => oauthMetadataResponse(request, authMetadataOptions) ?? status(404))
    .get('/.well-known/oauth-protected-resource/mcp', ({ request }) => oauthMetadataResponse(request, authMetadataOptions) ?? status(404))
    .options('/.well-known/oauth-authorization-server', ({ request }) => oauthMetadataResponse(request, authMetadataOptions) ?? status(404))
    .options('/.well-known/oauth-protected-resource/mcp', ({ request }) => oauthMetadataResponse(request, authMetadataOptions) ?? status(404))
    .post('/oauth/register', ({ body }) => {
      return status(201, {
        client_id: serverUrl,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: body.redirect_uris ?? [],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    }, { body: registerBodySchema })
    .get('/oauth/authorize', ({ query, set }) => {
      const { redirect_uri, code_challenge, state, client_id } = query;
      if (!redirect_uri || !code_challenge) {
        return status(400, 'Missing required OAuth2 parameters');
      }
      if (!isAllowedRedirectUri(redirect_uri, allowedUris)) {
        return status(400, 'Invalid redirect_uri: not in the allowed list');
      }
      set.headers['Content-Type'] = 'text/html; charset=utf-8';
      set.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'";
      set.headers['X-Frame-Options'] = 'DENY';
      set.headers['X-Content-Type-Options'] = 'nosniff';
      return buildLoginPage({ redirectUri: redirect_uri, codeChallenge: code_challenge, state, clientId: client_id });
    }, { query: authorizeQuerySchema })
    .post('/oauth/token', async ({ body }) => {
      const { grant_type } = body;

      if (grant_type === 'afp_credentials') {
        const { username: reqUsername, password: reqPassword, redirect_uri, code_challenge } = body;
        if (!reqUsername || !reqPassword || !redirect_uri || !code_challenge) {
          return status(400, { error: 'invalid_request', error_description: 'Missing required fields' });
        }
        if (!isAllowedRedirectUri(redirect_uri, allowedUris)) {
          return status(400, { error: 'invalid_request', error_description: 'Invalid redirect_uri' });
        }
        let afpToken: AfpAuthToken;
        try {
          afpToken = await makeAfpClient().authenticate({ username: reqUsername, password: reqPassword });
        } catch {
          return status(401, { error: 'invalid_grant', error_description: 'Identifiants AFP invalides' });
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
        return { code };
      }

      if (grant_type === 'authorization_code') {
        const { code, code_verifier, redirect_uri } = body;
        if (!code || !code_verifier || !redirect_uri) {
          return status(400, { error: 'invalid_request', error_description: 'Missing code, code_verifier or redirect_uri' });
        }
        if (consumedAuthCodes.has(code)) {
          return status(400, { error: 'invalid_grant', error_description: 'Auth code already used' });
        }
        let authCode: Awaited<ReturnType<typeof decryptAuthCode>>;
        try {
          authCode = await decryptAuthCode(authCodeKey, code);
        } catch {
          return status(400, { error: 'invalid_grant', error_description: 'Auth code expired or invalid' });
        }
        const expectedChallenge = await sha256Base64Url(code_verifier);
        if (expectedChallenge !== authCode.codeChallenge) {
          return status(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        }
        if (authCode.redirectUri !== redirect_uri) {
          return status(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        }
        // Marked for at least the code's own max lifetime (5 min) — the
        // JWE's own expiry, checked above, is what actually bounds replay.
        consumedAuthCodes.set(code, Date.now() + 5 * 60 * 1000);

        return mintTokenResponse(
          { accessToken: authCode.at, refreshToken: authCode.rt, tokenExpires: authCode.exp },
          authCode.u,
        );
      }

      if (grant_type === 'refresh_token') {
        const { refresh_token } = body;
        if (!refresh_token) {
          return status(400, { error: 'invalid_request', error_description: 'Missing refresh_token' });
        }
        let afpRefreshToken: string;
        let username: string;
        try {
          ({ afpRefreshToken, username } = await decryptAfpRefreshToken(refreshKey, refresh_token));
        } catch {
          return status(401, { error: 'invalid_grant', error_description: 'Invalid refresh token' });
        }
        try {
          const client = makeAfpClient();
          client.token = { accessToken: '', refreshToken: afpRefreshToken, tokenExpires: 0, authType: 'credentials' };
          const newAfpToken: AfpAuthToken = await client.authenticate();
          return mintTokenResponse(newAfpToken, username);
        } catch {
          return status(401, { error: 'invalid_grant', error_description: 'Refresh token expired, please sign in again' });
        }
      }

      return status(400, { error: 'unsupported_grant_type' });
    }, { body: oauthTokenBodySchema })
    .all('/mcp', ({ request, body }) => handleMcpRequest(request, body))
    .listen(port, () => {
      console.log(`MCP HTTP server listening on port ${port}`);
    });
}
