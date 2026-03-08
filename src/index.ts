import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import 'dotenv/config';
import rateLimit from 'express-rate-limit';
import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { createServer } from './server.js';

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

async function encryptCredentials(
  key: Uint8Array,
  username: string,
  password: string,
): Promise<string> {
  return new EncryptJWT({ u: username, p: password })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .encrypt(key);
}

async function decryptCredentials(
  key: Uint8Array,
  token: string,
): Promise<{ username: string; password: string }> {
  const { payload } = await jwtDecrypt(token, key);
  const { u, p } = payload as { u: string; p: string };
  if (!u || !p) throw new Error('Invalid token payload');
  return { username: u, password: p };
}

function buildLoginPage(params: {
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  clientId?: string;
}): string {
  const p = {
    redirectUri: params.redirectUri.replace(/'/g, "\\'"),
    codeChallenge: params.codeChallenge.replace(/'/g, "\\'"),
    state: (params.state ?? '').replace(/'/g, "\\'"),
  };
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
            redirect_uri: '${p.redirectUri}',
            code_challenge: '${p.codeChallenge}',
            state: '${p.state}',
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error_description || 'Identifiants invalides');
        }
        const { code } = await res.json();
        const url = new URL('${p.redirectUri}');
        url.searchParams.set('code', code);
        if ('${p.state}') url.searchParams.set('state', '${p.state}');
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

async function startHttpServer() {
  const { default: express } = await import('express');

  const apiKey = process.env.APICORE_API_KEY;
  if (!apiKey) throw new Error('APICORE_API_KEY environment variable is required');

  const afpBaseUrl = process.env.APICORE_BASE_URL?.trim();

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  const serverUrl = process.env.MCP_SERVER_URL?.replace(/\/$/, '');
  if (!serverUrl) {
    throw new Error('MCP_SERVER_URL is required in HTTP mode (e.g. https://news-mcp.jub.cool)');
  }
  const encryptionKey = createHash('sha256').update(jwtSecret).digest();

  const app = express();

  type Session = { transport: StreamableHTTPServerTransport; server: McpServer; lastAccessedAt: number };
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

  // Task 3 — Auth code store with TTL cleanup
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

  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Task 6 — OAuth2 discovery metadata and DCR shim
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: serverUrl,
      authorization_endpoint: `${serverUrl}/oauth/authorize`,
      token_endpoint: `${serverUrl}/oauth/token`,
      registration_endpoint: `${serverUrl}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  const registerLimiter = rateLimit({ windowMs: 60_000, max: 20 });
  app.post('/oauth/register', registerLimiter, express.json(), (req, res) => {
    const body = req.body as { redirect_uris?: string[] } | undefined;
    res.status(201).json({
      client_id: serverUrl,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body?.redirect_uris ?? [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  // Task 4 — GET /oauth/authorize — AFP login page
  app.get('/oauth/authorize', (req, res) => {
    const { redirect_uri, code_challenge, state, client_id } = req.query as Record<string, string>;
    if (!redirect_uri || !code_challenge) {
      res.status(400).send('Missing required OAuth2 parameters');
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildLoginPage({ redirectUri: redirect_uri, codeChallenge: code_challenge, state, clientId: client_id }));
  });

  // Task 5 — POST /oauth/token
  const tokenLimiter = rateLimit({ windowMs: 60_000, max: 10 });
  app.post('/oauth/token', tokenLimiter, express.json(), async (req, res) => {
    const body = req.body as Record<string, string>;
    const grantType = body.grant_type;

    if (grantType === 'afp_credentials') {
      const { username: reqUsername, password: reqPassword, redirect_uri, code_challenge, state } = body;
      if (!reqUsername || !reqPassword || !redirect_uri || !code_challenge) {
        res.status(400).json({ error: 'invalid_request', error_description: 'Missing required fields' });
        return;
      }
      try {
        const { ApiCore } = await import('afpnews-api');
        const testClient = new ApiCore({ ...(afpBaseUrl ? { baseUrl: afpBaseUrl } : {}), apiKey });
        await testClient.authenticate({ username: reqUsername, password: reqPassword });
      } catch {
        res.status(401).json({ error: 'invalid_grant', error_description: 'Identifiants AFP invalides' });
        return;
      }
      const code = crypto.randomUUID();
      authCodes.set(code, {
        username: reqUsername,
        password: reqPassword,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      res.json({ code });
      return;
    }

    if (grantType === 'authorization_code') {
      const { code, code_verifier, redirect_uri } = body;
      if (!code || !code_verifier || !redirect_uri) {
        res.status(400).json({ error: 'invalid_request', error_description: 'Missing code, code_verifier or redirect_uri' });
        return;
      }
      const stored = authCodes.get(code);
      if (!stored || Date.now() > stored.expiresAt) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Auth code expired or not found' });
        return;
      }
      const expectedChallenge = createHash('sha256').update(code_verifier).digest('base64url');
      if (expectedChallenge !== stored.codeChallenge) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
        return;
      }
      if (stored.redirectUri !== redirect_uri) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        return;
      }
      authCodes.delete(code);
      const accessToken = await encryptCredentials(encryptionKey, stored.username, stored.password);
      const refreshToken = await encryptCredentials(encryptionKey, stored.username, stored.password);
      res.json({
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 30 * 24 * 3600,
        refresh_token: refreshToken,
      });
      return;
    }

    if (grantType === 'refresh_token') {
      const { refresh_token } = body;
      if (!refresh_token) {
        res.status(400).json({ error: 'invalid_request', error_description: 'Missing refresh_token' });
        return;
      }
      try {
        const { username: u, password: pw } = await decryptCredentials(encryptionKey, refresh_token);
        const accessToken = await encryptCredentials(encryptionKey, u, pw);
        res.json({
          access_token: accessToken,
          token_type: 'bearer',
          expires_in: 30 * 24 * 3600,
          refresh_token,
        });
      } catch {
        res.status(401).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
      }
      return;
    }

    res.status(400).json({ error: 'unsupported_grant_type' });
  });

  // Task 7 — /mcp with JWE token validation
  app.all('/mcp', async (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Bearer token required' });
      return;
    }

    const token = authHeader.slice(7);
    let mcpUsername: string;
    let mcpPassword: string;

    try {
      ({ username: mcpUsername, password: mcpPassword } = await decryptCredentials(encryptionKey, token));
    } catch {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.lastAccessedAt = Date.now();
      await session.transport.handleRequest(req, res);
      return;
    }

    if (sessionId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    const server = await createServer({ apiKey, username: mcpUsername, password: mcpPassword, baseUrl: afpBaseUrl });
    await server.connect(transport);

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        sessions.delete(sid);
        console.error(`Session ${sid} closed`);
      }
    };

    await transport.handleRequest(req, res);

    const sid = transport.sessionId;
    if (sid) {
      sessions.set(sid, { transport, server, lastAccessedAt: Date.now() });
      console.error(`Session ${sid} created (user: ${mcpUsername})`);
    }
  });

  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, () => {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
  });
}
