import { z } from 'zod';
import { ServerContext } from './context.js';
import { formatDocument, GENRE_EXCLUSIONS } from './format.js';

export function registerTools({ server, apicore, authenticate }: ServerContext) {
  server.registerTool("search",
    {
      description: "Search AFP news articles",
      inputSchema: {
        query: z.string().describe("List of keywords to search for in the news articles (e.g. 'climate change'), in the language specified by the 'lang' parameter. If not specified, the search will be performed in all languages. Do not use keywords in multiple languages."),
        langs: z.string().array().optional().describe("Language of the news articles (e.g. 'en', 'fr')"),
        dateFrom: z.string().optional().describe("Start date for the search in ISO format (e.g. '2023-01-01')"),
        dateTo: z.string().optional().describe("End date for the search in ISO format (e.g. '2023-12-31')"),
        size: z.number().optional().describe("Number of results to return (default 10, max 1000)"),
        sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
        offset: z.number().optional().describe("Offset for pagination (number of results to skip)"),
        country: z.string().array().optional().describe("Country filter (e.g. 'fra', 'usa')"),
        slug: z.string().array().optional().describe("Topic/slug filter (e.g. 'economy', 'sports')"),
        product: z.enum(['news', 'photo', 'video', 'multimedia', 'graphic', 'videographic']).optional().describe("Content type filter (default 'news')"),
        includeAgendas: z.boolean().optional().describe("Whether to include agenda items in the search results (default false)")
      }
    },
    async ({ query, langs, dateFrom, dateTo, size, sortOrder, offset, country, slug, product = 'news', includeAgendas = false }) => {
      await authenticate();
      const { documents, count } = await apicore.search({
        query,
        langs,
        product,
        dateFrom,
        dateTo,
        size,
        sortOrder,
        startAt: offset,
        country,
        slug,
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
}
