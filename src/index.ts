import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthToken } from 'afpnews-api';
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

type StdioAuthConfig =
  | { mode: 'token'; token: AuthToken }
  | { mode: 'credentials'; apiKey: string; username: string; password: string };

function parseAuthToken(tokenValue: string): AuthToken {
  let parsed: unknown;
  try {
    parsed = JSON.parse(tokenValue);
  } catch {
    throw new Error('APICORE_AUTH_TOKEN must be a valid JSON object');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('APICORE_AUTH_TOKEN must be a JSON object');
  }

  const token = parsed as Partial<AuthToken>;
  if (
    typeof token.accessToken !== 'string' ||
    typeof token.refreshToken !== 'string' ||
    typeof token.tokenExpires !== 'number' ||
    (token.authType !== 'anonymous' && token.authType !== 'credentials')
  ) {
    throw new Error(
      'APICORE_AUTH_TOKEN must include accessToken, refreshToken, tokenExpires and authType',
    );
  }

  return token as AuthToken;
}

export function resolveStdioAuthConfig(env: NodeJS.ProcessEnv = process.env): StdioAuthConfig {
  const rawToken = env.APICORE_AUTH_TOKEN?.trim();
  if (rawToken) {
    return { mode: 'token', token: parseAuthToken(rawToken) };
  }

  const apiKey = env.APICORE_API_KEY?.trim();
  const username = env.APICORE_USERNAME?.trim();
  const password = env.APICORE_PASSWORD?.trim();

  if (!apiKey || !username || !password) {
    throw new Error(
      'Missing stdio auth configuration: set APICORE_AUTH_TOKEN or APICORE_API_KEY + APICORE_USERNAME + APICORE_PASSWORD.',
    );
  }

  return { mode: 'credentials', apiKey, username, password };
}

async function startHttpServer() {
  const { default: express } = await import('express');

  const apiKey = process.env.APICORE_API_KEY;
  if (!apiKey) {
    throw new Error('APICORE_API_KEY environment variable is required');
  }

  const app = express();

  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();

  app.all('/mcp', async (req, res) => {
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

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
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

    const server = await createServer(apiKey, credentials.username, credentials.password);
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
      sessions.set(sid, { transport, server });
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
  const server =
    authConfig.mode === 'token'
      ? await createServer(authConfig.token)
      : await createServer(authConfig.apiKey, authConfig.username, authConfig.password);
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
