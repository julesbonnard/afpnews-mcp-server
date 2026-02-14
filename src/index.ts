import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ApiCore } from 'afpnews-api';

const apicore = new ApiCore({
  apiKey: process.env.APICORE_API_KEY
});

const server = new McpServer(
  {
    name: 'afpnews',
    version: '1.0.0',
  }
);

async function authenticate() {
  await apicore.authenticate({
    username: process.env.APICORE_USERNAME || '',
    password: process.env.APICORE_PASSWORD || ''
  });
}

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
      country: z.string().optional().describe("Country filter (e.g. 'FR', 'US')"),
      topic: z.string().optional().describe("Topic/slug filter (e.g. 'economy', 'sports')")
    }
  },
  async ({
    query,
    lang,
    dateFrom,
    dateTo,
    size,
    sortOrder,
    offset,
    country,
    topic
  }) => {
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
      country: country ? [country] : undefined,
      topic: topic ? [topic] : undefined,
      genreid: GENRE_EXCLUSIONS
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
    const doc = await (apicore as any).get(uno);
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
    const { documents, count } = await (apicore as any).mlt(uno, lang, size);
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
    const result = await (apicore as any).list(facet, params, size);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result, null, 2)
      }]
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Serveur MCP démarré");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
