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


server.registerTool("search",
  {
    description: "Search AFP news article",
    inputSchema: {
      query: z.string().describe("List of keywords to search for in the news articles (e.g. 'climate change'), in the language specified by the 'lang' parameter. If not specified, the search will be performed in all languages. Do not use keywords in mult"),
      lang: z.string().optional().describe("Language of the news articles (e.g. 'en', 'fr')"),
      dateFrom: z.string().optional().describe("Start date for the search in ISO format (e.g. '2023-01-01')"),
      dateTo: z.string().optional().describe("End date for the search in ISO format (e.g. '2023-12-31')")
    }
  },
  async ({
    query,
    lang,
    dateFrom,
    dateTo
  }) => {
    await apicore.authenticate({
        username: process.env.APICORE_USERNAME || '',
        password: process.env.APICORE_PASSWORD || ''
    });
    const { documents, count } = await apicore.search({
        query,
        langs: lang ? [lang] : undefined,
        product: 'news',
        dateFrom,
        dateTo,
        size: 10,
        genreid: {
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
        }
    })
    if (count === 0) {
        throw new Error('No results found');
    }
    return {
      content: documents.map(doc => ({
        type: 'text',
        published: new Date((doc as any).published),
        title: String((doc as any).headline),
        text: String((doc as any).news.join(`

          `)).substring(0, 10000),
        lang: String((doc as any).lang),
        genre: String((doc as any).genre)
      }))
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
