import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Elysia, t, status } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';
import { createServer, type AfpAuthToken } from '../mcp-server.js';
import { deriveKey, encryptAfpToken, decryptAfpToken, encryptAfpRefreshToken, decryptAfpRefreshToken, type AfpTokenPayload } from './tokens.js';
import { buildLoginPage, buildAllowedUris, isAllowedRedirectUri } from './login-page.js';
import { ApiCore } from 'afpnews-api';
import { createHash } from 'node:crypto';

type HttpConfig = {
  apiKey: string;
  afpBaseUrl: string | undefined;
  jwtSecret: string;
  serverUrl: string;
  port: number;
  sessionTtlMs: number;
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

  const sessionTtlMs = parseInt(env.MCP_SESSION_TTL || '3600000', 10);
  if (isNaN(sessionTtlMs) || sessionTtlMs <= 0) throw new Error('MCP_SESSION_TTL must be a positive integer (milliseconds)');

  const afpBaseUrl = env.APICORE_BASE_URL?.trim();
  if (!afpBaseUrl) throw new Error('APICORE_BASE_URL environment variable is required');

  return { apiKey, afpBaseUrl, jwtSecret, serverUrl, port, sessionTtlMs };
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
  const { apiKey, afpBaseUrl, jwtSecret, serverUrl, port, sessionTtlMs } = resolveHttpConfig();

  const allowedUris = buildAllowedUris();
  console.debug(`Allowed redirect URIs: localhost/* + ${allowedUris.filter(u => !u.includes('localhost')).join(', ')}`);

  const accessKey = deriveKey(jwtSecret, 'access-token');
  const refreshKey = deriveKey(jwtSecret, 'refresh-token');

  type Session = { transport: WebStandardStreamableHTTPServerTransport; server: McpServer; lastAccessedAt: number; username: string };
  const sessions = new Map<string, Session>();

  type AuthCode = { username: string; afpToken: AfpAuthToken; redirectUri: string; codeChallenge: string; expiresAt: number };
  const authCodes = new Map<string, AuthCode>();

  setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of sessions) {
      if (now - session.lastAccessedAt > sessionTtlMs) {
        sessions.delete(sid);
        console.debug(`Session ${sid} expired`);
      }
    }
    for (const [code, data] of authCodes) {
      if (now > data.expiresAt) authCodes.delete(code);
    }
  }, 60_000);

  const makeAfpClient = () => new ApiCore({ baseUrl: afpBaseUrl, apiKey });

  const mintTokenResponse = async (afpToken: AfpAuthToken, username: string) => {
    const accessToken = await encryptAfpToken(accessKey, {
      at: afpToken.accessToken,
      rt: afpToken.refreshToken,
      exp: afpToken.tokenExpires,
      u: username,
    });
    const refreshToken = await encryptAfpRefreshToken(refreshKey, afpToken.refreshToken, username);
    const expiresIn = Math.max(60, Math.floor((afpToken.tokenExpires - Date.now()) / 1000));
    return { access_token: accessToken, token_type: 'bearer', expires_in: expiresIn, refresh_token: refreshToken };
  };

  const ipGenerator = (req: Request) =>
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';

  async function handleMcpRequest(request: Request, body: unknown): Promise<Response> {
    const authHeader = request.headers.get('authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({ error: 'Bearer token required' }, {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
    }

    const token = authHeader.slice(7);
    let afpPayload: AfpTokenPayload;

    try {
      afpPayload = await decryptAfpToken(accessKey, token);
    } catch {
      return Response.json({ error: 'Invalid or expired token' }, {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
      });
    }

    const sessionId = request.headers.get('mcp-session-id');

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (session.username !== afpPayload.u) {
        return Response.json({ error: 'Token does not match session' }, { status: 401 });
      }
      session.lastAccessedAt = Date.now();
      return session.transport.handleRequest(request, { parsedBody: body });
    }

    if (sessionId) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    const server = await createServer({
      apiKey,
      authToken: { accessToken: afpPayload.at, refreshToken: afpPayload.rt, tokenExpires: afpPayload.exp },
      baseUrl: afpBaseUrl,
    });
    await server.connect(transport);

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        sessions.delete(sid);
        console.debug(`Session ${sid} closed`);
      }
    };

    const response = await transport.handleRequest(request, { parsedBody: body });

    const sid = transport.sessionId;
    if (sid) {
      sessions.set(sid, { transport, server, lastAccessedAt: Date.now(), username: afpPayload.u });
      console.debug(`Session ${sid} created (user: ${afpPayload.u})`);
    }

    return response;
  }

  new Elysia()
    .use(rateLimit({ max: 20, duration: 60_000, generator: ipGenerator }))
    .get('/health', () => ({ status: 'ok' }))
    .get('/.well-known/oauth-authorization-server', () => ({
      issuer: serverUrl,
      authorization_endpoint: `${serverUrl}/oauth/authorize`,
      token_endpoint: `${serverUrl}/oauth/token`,
      registration_endpoint: `${serverUrl}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    }))
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
        const code = crypto.randomUUID();
        authCodes.set(code, {
          username: reqUsername,
          afpToken,
          redirectUri: redirect_uri,
          codeChallenge: code_challenge,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });
        return { code };
      }

      if (grant_type === 'authorization_code') {
        const { code, code_verifier, redirect_uri } = body;
        if (!code || !code_verifier || !redirect_uri) {
          return status(400, { error: 'invalid_request', error_description: 'Missing code, code_verifier or redirect_uri' });
        }
        const stored = authCodes.get(code);
        if (!stored || Date.now() > stored.expiresAt) {
          return status(400, { error: 'invalid_grant', error_description: 'Auth code expired or not found' });
        }
        const expectedChallenge = createHash('sha256').update(code_verifier).digest('base64url');
        if (expectedChallenge !== stored.codeChallenge) {
          return status(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        }
        if (stored.redirectUri !== redirect_uri) {
          return status(400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        }
        authCodes.delete(code);

        return mintTokenResponse(stored.afpToken, stored.username);
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
    .post('/mcp', ({ request, body }) => handleMcpRequest(request, body))
    .listen(port, () => {
      console.log(`MCP HTTP server listening on port ${port}`);
    });
}
