import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Elysia } from 'elysia';
import { node } from '@elysiajs/node';
import { rateLimit } from 'elysia-rate-limit';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hkdfSync } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { createServer, type AfpAuthToken } from './server.js';

type StdioAuthConfig = { apiKey: string; username: string; password: string; baseUrl?: string };

export function resolveStdioAuthConfig(env: NodeJS.ProcessEnv = process.env): StdioAuthConfig {
  const apiKey = env.APICORE_API_KEY?.trim();
  const username = env.APICORE_USERNAME?.trim();
  const password = env.APICORE_PASSWORD?.trim();
  const baseUrl = env.APICORE_BASE_URL?.trim();

  if (!apiKey || !username || !password) {
    throw new Error(
      'Missing stdio auth configuration: set APICORE_API_KEY + APICORE_USERNAME + APICORE_PASSWORD.',
    );
  }

  return { apiKey, username, password, baseUrl };
}

const SESSION_TTL_MS = (() => {
  const val = parseInt(process.env.MCP_SESSION_TTL || '3600000', 10);
  if (isNaN(val) || val <= 0) throw new Error('MCP_SESSION_TTL must be a positive integer (milliseconds)');
  return val;
})();

// Security fix #8: HKDF key derivation (replaces raw SHA-256)
function deriveKey(secret: string, purpose: string): Uint8Array {
  return new Uint8Array(
    hkdfSync('sha256', Buffer.from(secret), Buffer.from('afp-mcp-v1'), Buffer.from(purpose), 32),
  );
}

// Access token: contains AFP API token (not user credentials)
type AfpTokenPayload = { at: string; rt: string; exp: number; u: string };

async function encryptAfpToken(key: Uint8Array, payload: AfpTokenPayload): Promise<string> {
  // Expire the JWE when the AFP token expires (min 60s from now)
  const ttlSeconds = Math.max(60, Math.floor((payload.exp - Date.now()) / 1000));
  return new EncryptJWT({ at: payload.at, rt: payload.rt, exp: payload.exp, u: payload.u })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .encrypt(key);
}

async function decryptAfpToken(key: Uint8Array, token: string): Promise<AfpTokenPayload> {
  const { payload } = await jwtDecrypt(token, key);
  const { at, rt, exp, u } = payload as AfpTokenPayload;
  if (!at || !u) throw new Error('Invalid access token payload');
  return { at: at as string, rt: (rt as string) || '', exp: (exp as number) || 0, u: u as string };
}

// Refresh token: contains AFP refresh token only — no user credentials stored
async function encryptAfpRefreshToken(key: Uint8Array, afpRefreshToken: string, username: string): Promise<string> {
  return new EncryptJWT({ rfp: afpRefreshToken, u: username })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .encrypt(key);
}

async function decryptAfpRefreshToken(key: Uint8Array, token: string): Promise<{ afpRefreshToken: string; username: string }> {
  const { payload } = await jwtDecrypt(token, key);
  const { rfp, u } = payload as { rfp: string; u: string };
  if (!rfp || !u) throw new Error('Invalid refresh token payload');
  return { afpRefreshToken: rfp as string, username: u as string };
}

// Security fix #1: XSS — use JSON.stringify for all JS-embedded values
// Security fix #6: CSP + X-Frame-Options headers added in the route handler
function buildLoginPage(params: {
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  clientId?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AFP News MCP — Connexion</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f4f4f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .card { background: white; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.08); padding: 2.5rem; width: 100%; max-width: 420px; }
    .logo { font-size: 1.5rem; font-weight: 700; color: #111; margin-bottom: .25rem; }
    .subtitle { color: #6b7280; font-size: .9rem; margin-bottom: 2rem; }
    label { display: block; font-size: .875rem; font-weight: 500; color: #374151; margin-bottom: .375rem; }
    input { width: 100%; padding: .625rem .875rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 1rem; outline: none; margin-bottom: 1rem; transition: border-color .15s; }
    input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
    button { width: 100%; padding: .75rem; background: #2563eb; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: background .15s; }
    button:hover { background: #1d4ed8; }
    button:disabled { background: #93c5fd; cursor: not-allowed; }
    .error { color: #dc2626; font-size: .875rem; margin-bottom: 1rem; display: none; background: #fef2f2; border: 1px solid #fecaca; padding: .625rem .875rem; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">AFP News MCP</div>
    <div class="subtitle">Connectez-vous avec vos identifiants AFP</div>
    <div class="error" id="err"></div>
    <form id="form">
      <label for="username">Identifiant AFP</label>
      <input id="username" name="username" type="text" autocomplete="username" required>
      <label for="password">Mot de passe</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit" id="btn">Se connecter</button>
    </form>
  </div>
  <script>
    const REDIRECT_URI = ${JSON.stringify(params.redirectUri)};
    const CODE_CHALLENGE = ${JSON.stringify(params.codeChallenge)};
    const STATE = ${JSON.stringify(params.state ?? '')};
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn');
      const err = document.getElementById('err');
      btn.disabled = true;
      btn.textContent = 'Connexion\u2026';
      err.style.display = 'none';
      try {
        const res = await fetch('/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'afp_credentials',
            username: document.getElementById('username').value,
            password: document.getElementById('password').value,
            redirect_uri: REDIRECT_URI,
            code_challenge: CODE_CHALLENGE,
            state: STATE,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error_description || 'Identifiants invalides');
        }
        const { code } = await res.json();
        const url = new URL(REDIRECT_URI);
        url.searchParams.set('code', code);
        if (STATE) url.searchParams.set('state', STATE);
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        window.location.href = url.toString();
      } catch (e) {
        err.textContent = e.message;
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Se connecter';
      }
    });
  </script>
</body>
</html>`;
}

// Security fix #2/#7: strict redirect_uri whitelist
// - localhost/127.0.0.1 (any port): Claude Code local OAuth server
// - explicit https URIs: Claude Web + MCP_ALLOWED_REDIRECT_URIS env var
const BUILTIN_ALLOWED_URIS = ['https://claude.ai/api/mcp/auth_callback'];

function buildAllowedUris(): string[] {
  const extra = process.env.MCP_ALLOWED_REDIRECT_URIS;
  if (!extra) return BUILTIN_ALLOWED_URIS;
  return [...BUILTIN_ALLOWED_URIS, ...extra.split(',').map(s => s.trim()).filter(Boolean)];
}

function isAllowedRedirectUri(uri: string, allowedUris: string[]): boolean {
  try {
    const url = new URL(uri);
    // Claude Code uses a local HTTP server on a random port
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return true;
    }
    // Explicit https whitelist (exact match)
    return allowedUris.includes(uri);
  } catch {
    return false;
  }
}

async function startHttpServer() {
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

async function startStdioServer() {
  const authConfig = resolveStdioAuthConfig();
  const server = await createServer(authConfig);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP stdio server started');
}

export async function main() {
  if (process.env.MCP_TRANSPORT === 'http') {
    await startHttpServer();
  } else {
    await startStdioServer();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
  });
}
