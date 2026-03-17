import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Elysia } from 'elysia';
import { node } from '@elysiajs/node';
import { rateLimit } from 'elysia-rate-limit';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type AfpAuthToken } from '../server.js';
import { deriveKey, encryptAfpToken, decryptAfpToken, encryptAfpRefreshToken, decryptAfpRefreshToken, type AfpTokenPayload } from './tokens.js';
import { buildLoginPage, buildAllowedUris, isAllowedRedirectUri } from './login-page.js';

const SESSION_TTL_MS = (() => {
  const val = parseInt(process.env.MCP_SESSION_TTL || '3600000', 10);
  if (isNaN(val) || val <= 0) throw new Error('MCP_SESSION_TTL must be a positive integer (milliseconds)');
  return val;
})();

export async function startHttpServer() {
  const apiKeyRaw = process.env.APICORE_API_KEY;
  if (!apiKeyRaw) throw new Error('APICORE_API_KEY environment variable is required');
  const apiKey: string = apiKeyRaw;

  const afpBaseUrl = process.env.APICORE_BASE_URL?.trim();

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  const serverUrl = process.env.MCP_SERVER_URL?.replace(/\/$/, '');
  if (!serverUrl) {
    throw new Error('MCP_SERVER_URL is required in HTTP mode (e.g. https://news-mcp.jub.cool)');
  }

  const allowedUris = buildAllowedUris();
  console.error(`Allowed redirect URIs: localhost/* + ${allowedUris.filter(u => !u.includes('localhost')).join(', ')}`);

  // Security fix #8: HKDF — separate keys for access vs refresh tokens
  const accessKey = deriveKey(jwtSecret, 'access-token');
  const refreshKey = deriveKey(jwtSecret, 'refresh-token');

  // Security fix #5: sessions store username for binding validation
  type Session = { transport: StreamableHTTPServerTransport; server: McpServer; lastAccessedAt: number; username: string };
  const sessions = new Map<string, Session>();

  setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of sessions) {
      if (now - session.lastAccessedAt > SESSION_TTL_MS) {
        sessions.delete(sid);
        console.error(`Session ${sid} expired`);
      }
    }
  }, 60_000);

  type AuthCode = {
    username: string;
    password: string;
    redirectUri: string;
    codeChallenge: string;
    expiresAt: number;
  };
  const authCodes = new Map<string, AuthCode>();

  setInterval(() => {
    const now = Date.now();
    for (const [code, data] of authCodes) {
      if (now > data.expiresAt) authCodes.delete(code);
    }
  }, 60_000);

  // IP extractor for rate limiting (X-Forwarded-For from Traefik)
  const ipGenerator = (req: Request) =>
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';

  // /mcp: decrypt AFP token from access token, reuse or create session
  async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, headers: Record<string, string | string[] | undefined>, body: unknown) {
    const authHeader = headers['authorization'];
    const authHeaderStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (!authHeaderStr?.startsWith('Bearer ')) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bearer token required' }));
      return;
    }

    const token = authHeaderStr.slice(7);
    let afpPayload: AfpTokenPayload;

    try {
      afpPayload = await decryptAfpToken(accessKey, token);
    } catch {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer error="invalid_token"', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or expired token' }));
      return;
    }

    const sessionIdRaw = headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdRaw) ? sessionIdRaw[0] : sessionIdRaw;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      // Security fix #5: bind session to username — prevent session hijacking across users
      if (session.username !== afpPayload.u) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token does not match session' }));
        return;
      }
      session.lastAccessedAt = Date.now();
      await session.transport.handleRequest(req, res, body);
      return;
    }

    if (sessionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    const transport = new StreamableHTTPServerTransport({
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
        console.error(`Session ${sid} closed`);
      }
    };

    await transport.handleRequest(req, res, body);

    const sid = transport.sessionId;
    if (sid) {
      sessions.set(sid, { transport, server, lastAccessedAt: Date.now(), username: afpPayload.u });
      console.error(`Session ${sid} created (user: ${afpPayload.u})`);
    }
  }

  const port = parseInt(process.env.PORT || '3000', 10);

  new Elysia({ adapter: node() })
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
    .use(
      new Elysia()
        .use(rateLimit({ max: 20, duration: 60_000, generator: ipGenerator }))
        .post('/oauth/register', ({ body, set }: any) => {
          const b = body as { redirect_uris?: string[] } | undefined;
          set.status = 201;
          return {
            client_id: serverUrl,
            client_id_issued_at: Math.floor(Date.now() / 1000),
            redirect_uris: b?.redirect_uris ?? [],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          };
        }),
    )
    // Security fix #2/#6/#7: validate redirect_uri + CSP + X-Frame-Options
    .get('/oauth/authorize', ({ query, set }: any) => {
      const { redirect_uri, code_challenge, state, client_id } = query as Record<string, string>;
      if (!redirect_uri || !code_challenge) {
        set.status = 400;
        return 'Missing required OAuth2 parameters';
      }
      if (!isAllowedRedirectUri(redirect_uri, allowedUris)) {
        set.status = 400;
        return 'Invalid redirect_uri: not in the allowed list';
      }
      set.headers['Content-Type'] = 'text/html; charset=utf-8';
      set.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'";
      set.headers['X-Frame-Options'] = 'DENY';
      set.headers['X-Content-Type-Options'] = 'nosniff';
      return buildLoginPage({ redirectUri: redirect_uri, codeChallenge: code_challenge, state, clientId: client_id });
    })
    // Security fix #3/#4: rate limiting + body size limit
    .use(
      new Elysia()
        .use(rateLimit({ max: 10, duration: 60_000, generator: ipGenerator }))
        .post('/oauth/token', async ({ body, set }: any) => {
          const b = body as Record<string, string>;
          const grantType = b.grant_type;

          // Grant: AFP login — validate AFP credentials, issue auth code
          if (grantType === 'afp_credentials') {
            const { username: reqUsername, password: reqPassword, redirect_uri, code_challenge } = b;
            if (!reqUsername || !reqPassword || !redirect_uri || !code_challenge) {
              set.status = 400;
              return { error: 'invalid_request', error_description: 'Missing required fields' };
            }
            if (!isAllowedRedirectUri(redirect_uri, allowedUris)) {
              set.status = 400;
              return { error: 'invalid_request', error_description: 'Invalid redirect_uri' };
            }
            try {
              const { ApiCore } = await import('afpnews-api');
              const testClient = new ApiCore({ ...(afpBaseUrl ? { baseUrl: afpBaseUrl } : {}), apiKey });
              await testClient.authenticate({ username: reqUsername, password: reqPassword });
            } catch {
              set.status = 401;
              return { error: 'invalid_grant', error_description: 'Identifiants AFP invalides' };
            }
            const code = crypto.randomUUID();
            authCodes.set(code, {
              username: reqUsername,
              password: reqPassword,
              redirectUri: redirect_uri,
              codeChallenge: code_challenge,
              expiresAt: Date.now() + 5 * 60 * 1000,
            });
            return { code };
          }

          // Grant: authorization_code — PKCE check, issue AFP-token-based access token + credential-based refresh token
          if (grantType === 'authorization_code') {
            const { code, code_verifier, redirect_uri } = b;
            if (!code || !code_verifier || !redirect_uri) {
              set.status = 400;
              return { error: 'invalid_request', error_description: 'Missing code, code_verifier or redirect_uri' };
            }
            const stored = authCodes.get(code);
            if (!stored || Date.now() > stored.expiresAt) {
              set.status = 400;
              return { error: 'invalid_grant', error_description: 'Auth code expired or not found' };
            }
            const { createHash } = await import('node:crypto');
            const expectedChallenge = createHash('sha256').update(code_verifier).digest('base64url');
            if (expectedChallenge !== stored.codeChallenge) {
              set.status = 400;
              return { error: 'invalid_grant', error_description: 'PKCE verification failed' };
            }
            if (stored.redirectUri !== redirect_uri) {
              set.status = 400;
              return { error: 'invalid_grant', error_description: 'redirect_uri mismatch' };
            }
            authCodes.delete(code);

            // Security fix #9: access token = AFP API token (short-lived), refresh token = credentials (30d)
            let afpToken: AfpAuthToken;
            try {
              const { ApiCore } = await import('afpnews-api');
              const client = new ApiCore({ ...(afpBaseUrl ? { baseUrl: afpBaseUrl } : {}), apiKey });
              afpToken = await client.authenticate({ username: stored.username, password: stored.password });
            } catch {
              set.status = 502;
              return { error: 'server_error', error_description: 'AFP authentication failed' };
            }

            const accessToken = await encryptAfpToken(accessKey, {
              at: afpToken.accessToken,
              rt: afpToken.refreshToken,
              exp: afpToken.tokenExpires,
              u: stored.username,
            });
            const refreshToken = await encryptAfpRefreshToken(refreshKey, afpToken.refreshToken, stored.username);
            const expiresIn = Math.max(60, Math.floor((afpToken.tokenExpires - Date.now()) / 1000));
            return { access_token: accessToken, token_type: 'bearer', expires_in: expiresIn, refresh_token: refreshToken };
          }

          // Grant: refresh_token — use AFP refresh token to get a new AFP access token (no credentials needed)
          if (grantType === 'refresh_token') {
            const { refresh_token } = b;
            if (!refresh_token) {
              set.status = 400;
              return { error: 'invalid_request', error_description: 'Missing refresh_token' };
            }
            let afpRefreshToken: string;
            let username: string;
            try {
              ({ afpRefreshToken, username } = await decryptAfpRefreshToken(refreshKey, refresh_token));
            } catch {
              set.status = 401;
              return { error: 'invalid_grant', error_description: 'Invalid refresh token' };
            }
            try {
              const { ApiCore } = await import('afpnews-api');
              const client = new ApiCore({ ...(afpBaseUrl ? { baseUrl: afpBaseUrl } : {}), apiKey });
              // Set an expired token so authenticate() triggers requestRefreshToken() internally
              client.token = { accessToken: '', refreshToken: afpRefreshToken, tokenExpires: 0, authType: 'credentials' };
              const newAfpToken: AfpAuthToken = await client.authenticate();
              const accessToken = await encryptAfpToken(accessKey, {
                at: newAfpToken.accessToken,
                rt: newAfpToken.refreshToken,
                exp: newAfpToken.tokenExpires,
                u: username,
              });
              // AFP may rotate its refresh token — always return the latest one
              const newRefreshToken = await encryptAfpRefreshToken(refreshKey, newAfpToken.refreshToken, username);
              const expiresIn = Math.max(60, Math.floor((newAfpToken.tokenExpires - Date.now()) / 1000));
              return { access_token: accessToken, token_type: 'bearer', expires_in: expiresIn, refresh_token: newRefreshToken };
            } catch {
              // AFP refresh token expired or revoked — client must re-authenticate via /oauth/authorize
              set.status = 401;
              return { error: 'invalid_grant', error_description: 'Refresh token expired, please sign in again' };
            }
          }

          set.status = 400;
          return { error: 'unsupported_grant_type' };
        }),
    )
    .get('/mcp', ({ node: { req, res } }: any) => handleMcpRequest(req, res, req.headers, undefined))
    .post('/mcp', ({ node: { req, res }, body }: any) => handleMcpRequest(req, res, req.headers, body))
    .delete('/mcp', ({ node: { req, res } }: any) => handleMcpRequest(req, res, req.headers, undefined))
    .listen(port, () => {
      console.error(`MCP HTTP server listening on port ${port}`);
    });
}
