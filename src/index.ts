import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { ApiCore } from 'afpnews-api';
import 'dotenv/config';

const GENRE_EXCLUSIONS = {
  exclude: [
    'afpgenre:Agenda',
    'afpattribute:Agenda',
    'afpattribute:Program',
    'afpattribute:TextProgram',
    'afpattribute:AdvisoryUpdate',
    'afpattribute:Advice',
    'afpattribute:SpecialAnnouncement',
    'afpattribute:PictureProgram'
  ]
};

function formatDocument(doc: any) {
  return {
    type: 'text' as const,
    uno: String(doc.uno),
    published: new Date(doc.published),
    title: String(doc.headline),
    text: String(doc.news.join('\n\n')).substring(0, 10000),
    lang: String(doc.lang),
    genre: String(doc.genre)
  };
}

function createServer(apiKey: string, username: string, password: string): McpServer {
  const apicore = new ApiCore({ apiKey });

  async function authenticate() {
    if (apicore.isTokenValid) return;
    await apicore.authenticate({ username, password });
  }

  const server = new McpServer({
    name: 'afpnews',
    version: '1.0.0',
  });

  server.registerTool("search",
    {
      description: "Search AFP news articles",
      inputSchema: {
        query: z.string().describe("List of keywords to search for in the news articles (e.g. 'climate change'), in the language specified by the 'lang' parameter. If not specified, the search will be performed in all languages. Do not use keywords in multiple languages."),
        lang: z.string().optional().describe("Language of the news articles (e.g. 'en', 'fr')"),
        dateFrom: z.string().optional().describe("Start date for the search in ISO format (e.g. '2023-01-01')"),
        dateTo: z.string().optional().describe("End date for the search in ISO format (e.g. '2023-12-31')"),
        size: z.number().optional().describe("Number of results to return (default 10, max 1000)"),
        sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
        offset: z.number().optional().describe("Offset for pagination (number of results to skip)"),
        country: z.string().array().optional().describe("Country filter (e.g. 'fra', 'usa')"),
        slug: z.string().array().optional().describe("Topic/slug filter (e.g. 'economy', 'sports')"),
        includeAgendas: z.boolean().optional().describe("Whether to include agenda items in the search results (default false)")
      }
    },
    async ({ query, lang, dateFrom, dateTo, size, sortOrder, offset, country, slug, includeAgendas = false }) => {
      await authenticate();
      const { documents, count } = await apicore.search({
        query,
        langs: lang ? [lang] : undefined,
        product: 'news',
        dateFrom,
        dateTo,
        size: Math.min(size ?? 10, 1000),
        sortOrder: sortOrder ?? 'desc',
        startAt: offset,
        country: country || undefined,
        slug: slug || undefined,
        genreid: includeAgendas ? undefined : GENRE_EXCLUSIONS
      } as any);
      if (count === 0) {
        throw new Error('No results found');
      }
      return {
        content: documents.map((doc: any) => formatDocument(doc))
      };
    }
  );

  server.registerTool("get",
    {
      description: "Get a full AFP news article by its UNO identifier",
      inputSchema: {
        uno: z.string().describe("The unique identifier (UNO) of the article")
      }
    },
    async ({ uno }) => {
      await authenticate();
      const doc = await apicore.get(uno);
      const d = doc as any;
      return {
        content: [{
          type: 'text' as const,
          uno: String(d.uno),
          published: new Date(d.published),
          title: String(d.headline),
          text: String(d.news.join('\n\n')),
          lang: String(d.lang),
          genre: String(d.genre)
        }]
      };
    }
  );

  server.registerTool("mlt",
    {
      description: "Find AFP news articles similar to a given article (More Like This)",
      inputSchema: {
        uno: z.string().describe("The UNO of the reference article"),
        lang: z.string().describe("Language for results (e.g. 'en', 'fr')"),
        size: z.number().optional().describe("Number of similar articles to return (default 10)")
      }
    },
    async ({ uno, lang, size }) => {
      await authenticate();
      const { documents, count } = await apicore.mlt(uno, lang, size);
      if (count === 0) {
        throw new Error('No similar articles found');
      }
      return {
        content: documents.map((doc: any) => formatDocument(doc))
      };
    }
  );

  server.registerTool("list",
    {
      description: "List values of a facet (e.g. slug, genre, country) with their document count, useful for discovering trending topics",
      inputSchema: {
        facet: z.string().describe("Facet to list (e.g. 'slug', 'genre', 'country')"),
        lang: z.string().optional().describe("Language filter (e.g. 'en', 'fr')"),
        size: z.number().optional().describe("Number of facet values to return")
      }
    },
    async ({ facet, lang, size }) => {
      await authenticate();
      const params: any = {};
      if (lang) params.langs = [lang];
      const result = await apicore.list(facet, params, size);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
  );

  return server;
}

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

    const server = createServer(apiKey, credentials.username, credentials.password);
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

  const server = createServer(apiKey, username, password);
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
