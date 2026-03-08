import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import 'dotenv/config';
import { createServer } from './server.js';

function decodeBasicAuth(header: string): { username: string; password: string } | null {
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
  const colon = decoded.indexOf(':');
  if (colon === -1) return null;
  return {
    username: decoded.substring(0, colon),
    password: decoded.substring(colon + 1)
  };
}

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

const SESSION_TTL_MS = parseInt(process.env.MCP_SESSION_TTL || '3600000', 10);

async function startHttpServer() {
  const { default: express } = await import('express');

  const apiKey = process.env.APICORE_API_KEY;
  if (!apiKey) {
    throw new Error('APICORE_API_KEY environment variable is required');
  }

  const baseUrl = process.env.APICORE_BASE_URL?.trim();
  const envUsername = process.env.APICORE_USERNAME?.trim();
  const envPassword = process.env.APICORE_PASSWORD?.trim();
  const useEnvCredentials = Boolean(envUsername && envPassword);

  const app = express();

  type Session = { transport: StreamableHTTPServerTransport; server: McpServer; lastAccessedAt: number };
  const sessions = new Map<string, Session>();

  // Nettoyage périodique des sessions expirées
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
    res.json({ status: 'ok', sessions: sessions.size });
  });

  app.all('/mcp', async (req, res) => {
    let username: string;
    let password: string;

    if (useEnvCredentials) {
      // Auth déléguée à Authentik — credentials AFP depuis les variables d'env
      username = envUsername!;
      password = envPassword!;
    } else {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.status(401).json({ error: 'Authorization header required' });
        return;
      }

      const credentials = decodeBasicAuth(authHeader);
      if (!credentials) {
        res.status(401).json({ error: 'Invalid Basic auth header' });
        return;
      }

      username = credentials.username;
      password = credentials.password;
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

    const server = await createServer({ apiKey, username, password, baseUrl });
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
