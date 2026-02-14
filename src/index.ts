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
  const apiKey = process.env.APICORE_API_KEY || '';
  const username = process.env.APICORE_USERNAME || '';
  const password = process.env.APICORE_PASSWORD || '';

  const server = await createServer(apiKey, username, password);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Serveur MCP démarré");
}

async function main() {
  if (process.env.MCP_TRANSPORT === 'http') {
    await startHttpServer();
  } else {
    await startStdioServer();
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
