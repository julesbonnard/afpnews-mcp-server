import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import 'dotenv/config';
import rateLimit from 'express-rate-limit';
import { createRemoteJWKSet, jwtVerify } from 'jose';
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

function buildAuthentikUrls(baseUrl: string, slug: string) {
  const base = baseUrl.replace(/\/$/, '');
  return {
    issuer: `${base}/application/o/${slug}/`,
    authorizationEndpoint: `${base}/application/o/authorize/`,
    tokenEndpoint: `${base}/application/o/token/`,
    jwksUri: `${base}/application/o/${slug}/jwks/`,
  };
}

async function startHttpServer() {
  const { default: express } = await import('express');

  const apiKey = process.env.APICORE_API_KEY;
  if (!apiKey) throw new Error('APICORE_API_KEY environment variable is required');

  const username = process.env.APICORE_USERNAME?.trim();
  const password = process.env.APICORE_PASSWORD?.trim();
  if (!username || !password) {
    throw new Error('APICORE_USERNAME and APICORE_PASSWORD are required in HTTP mode');
  }

  const afpBaseUrl = process.env.APICORE_BASE_URL?.trim();

  const authentikBaseUrl = process.env.AUTHENTIK_BASE_URL;
  const authentikSlug = process.env.AUTHENTIK_APP_SLUG;
  if (!authentikBaseUrl || !authentikSlug) {
    throw new Error('AUTHENTIK_BASE_URL and AUTHENTIK_APP_SLUG are required in HTTP mode');
  }

  const authentikClientId = process.env.AUTHENTIK_CLIENT_ID;
  if (!authentikClientId) {
    throw new Error('AUTHENTIK_CLIENT_ID is required in HTTP mode');
  }

  const serverUrl = process.env.MCP_SERVER_URL?.replace(/\/$/, '');
  if (!serverUrl) {
    throw new Error('MCP_SERVER_URL is required in HTTP mode (e.g. https://news-mcp.jub.cool)');
  }

  const urls = buildAuthentikUrls(authentikBaseUrl, authentikSlug);
  const jwks = createRemoteJWKSet(new URL(urls.jwksUri));

  const app = express();
  app.use('/oauth/register', express.json());

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

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // OAuth2 Authorization Server Metadata — découverte automatique par les clients MCP
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: urls.issuer,
      authorization_endpoint: urls.authorizationEndpoint,
      token_endpoint: urls.tokenEndpoint,
      jwks_uri: urls.jwksUri,
      registration_endpoint: `${serverUrl}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    });
  });

  // DCR shim — Authentik ne supporte pas la Dynamic Client Registration.
  // On accepte toute demande d'enregistrement et on renvoie le client_id Authentik pré-configuré.
  // Chaque utilisateur s'authentifie avec son propre compte Authentik, seul le client_id est partagé.
  // Le client_secret n'est jamais exposé ici : le flux PKCE (client public) suffit pour Claude Code et Claude Web.
  const registerLimiter = rateLimit({ windowMs: 60_000, max: 20 });
  app.post('/oauth/register', registerLimiter, (req, res) => {
    const body = req.body as { redirect_uris?: string[] } | undefined;
    res.status(201).json({
      client_id: authentikClientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body?.redirect_uris ?? [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  app.all('/mcp', async (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: 'Bearer token required' });
      return;
    }

    const token = authHeader.slice(7);
    try {
      await jwtVerify(token, jwks, { issuer: urls.issuer });
    } catch (err) {
      console.error('Token validation failed:', err);
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

    // No session ID — create a new session (transport will validate that it's an initialize request)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    const server = await createServer({ apiKey, username, password, baseUrl: afpBaseUrl });
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
      console.error(`Session ${sid} created`);
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
