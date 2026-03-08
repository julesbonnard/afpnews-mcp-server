import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import 'dotenv/config';
import rateLimit from 'express-rate-limit';
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

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  const serverUrl = process.env.MCP_SERVER_URL?.replace(/\/$/, '');
  if (!serverUrl) {
    throw new Error('MCP_SERVER_URL is required in HTTP mode (e.g. https://news-mcp.jub.cool)');
  }

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

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.all('/mcp', async (_req, res) => {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ error: 'Not implemented yet' });
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
