import { z } from 'zod';
import { ServerContext } from './server.js';
import { formatDocument, DEFAULT_FIELDS, GENRE_EXCLUSIONS } from './format.js';
import { searchAndFormat } from './helpers.js';
import { TOPICS } from './topics.js';

const ALL_TOPIC_VALUES = Object.values(TOPICS).flat().map(t => t.value);
const topicEnum = z.enum(ALL_TOPIC_VALUES as [string, ...string[]]);

export function registerTools({ server, apicore }: ServerContext) {
  server.registerTool("search",
    {
      description: "Search AFP news articles, return metadata and short summary (first 3 paragraphs) for each article",
      inputSchema: {
        query: z.string().optional().describe("List of keywords to search for in the news articles (e.g. 'climate change'), in the language specified by the 'lang' parameter. If not specified, the search will be performed in all languages. Do not use keywords in multiple languages."),
        lang: z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']).array().optional().describe("Language of the news articles (e.g. 'en', 'fr'). Always use 'en' if you look for photos."),
        dateFrom: z.string().optional().describe("Start date for the search in ISO format (e.g. '2023-01-01')"),
        dateTo: z.string().optional().describe("End date for the search in ISO format (e.g. '2023-12-31')"),
        size: z.number().optional().describe("Number of results to return (default 10, max 1000)"),
        sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
        offset: z.number().optional().describe("Offset for pagination (number of results to skip)"),
        country: z.string().array().optional().describe("Country filter (e.g. 'fra', 'usa')"),
        slug: z.string().array().optional().describe("Topic/slug filter (e.g. 'economy', 'sports')"),
        product: z.enum(['news', 'factcheck', 'photo', 'video', 'multimedia', 'graphic', 'videographic']).array().optional().describe("Content type filter (default ['news', 'factcheck'])")
      }
    },
    async ({ query, lang, dateFrom, dateTo, size, sortOrder, offset, country, slug, product = ['news', 'factcheck'] }) => {
      const { documents, count } = await apicore.search({
        query,
        lang,
        product,
        dateFrom,
        dateTo,
        size,
        sortOrder,
        startAt: offset,
        country,
        slug,
        genreid: GENRE_EXCLUSIONS
      }, [...DEFAULT_FIELDS]);
      if (count === 0) {
        return { content: [{ type: 'text' as const, text: 'No results found.' }] };
      }
      return {
        content: documents.map((doc: unknown) => formatDocument(doc, false))
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
      const doc = await apicore.get(uno);
      return {
        content: [formatDocument(doc, true)]
      };
    }
  );

  server.registerTool("mlt",
    {
      description: "Find AFP news articles similar to a given article (More Like This)",
      inputSchema: {
        uno: z.string().describe("The UNO of the reference article"),
        lang: z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']).describe("Language for results (e.g. 'en', 'fr')"),
        size: z.number().optional().describe("Number of similar articles to return (default 10)")
      }
    },
    async ({ uno, lang, size }) => {
      const { documents, count } = await apicore.mlt(uno, lang, size);
      if (count === 0) {
        return { content: [{ type: 'text' as const, text: 'No similar articles found.' }] };
      }
      return {
        content: documents.map((doc: unknown) => formatDocument(doc, false))
      };
    }
  );

  server.registerTool("list",
    {
      description: "List values of a facet (e.g. slug, genre, country) with their document count, useful for discovering trending topics",
      inputSchema: {
        facet: z.string().describe("Facet to list (e.g. 'slug', 'genre', 'country')"),
        lang: z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']).optional().describe("Language filter (e.g. 'en', 'fr')"),
        size: z.number().optional().describe("Number of facet values to return")
      }
    },
    async ({ facet, lang, size }) => {
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

  server.registerTool("a-la-une",
    {
      description: "Get the latest AFP news stories for a general audience in France (last 24h)",
      inputSchema: {}
    },
    async () => {
      const content = await searchAndFormat(apicore, {
        product: ['news'],
        lang: ['fr'],
        slug: ['afp', 'actualites'],
        dateFrom: 'now-1d',
        size: 15,
        sortOrder: 'desc',
        genreid: GENRE_EXCLUSIONS,
      }, true);
      return { content };
    }
  );

  server.registerTool("agenda",
    {
      description: "Get upcoming scheduled events and press releases from AFP",
      inputSchema: {
        lang: z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']).optional().describe("Language filter (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang = 'fr' }) => {
      const content = await searchAndFormat(apicore, {
        product: ['news'],
        lang: [lang],
        size: 15,
        sortOrder: 'desc',
        genreid: ['afpattribute:Agenda']
      }, true);
      return { content };
    }
  );

  server.registerTool("previsions",
    {
      description: "Get AFP editorial coverage plans — stories scheduled to be published soon",
      inputSchema: {
        lang: z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']).optional().describe("Language filter (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang = 'fr' }) => {
      const content = await searchAndFormat(apicore, {
        product: ['news'],
        lang: [lang],
        size: 15,
        sortOrder: 'desc',
        genreid: ['afpattribute:Program', 'afpedtype:TextProgram']
      }, true);
      return { content };
    }
  );

  server.registerTool("major-stories",
    {
      description: "Get the latest AFP major news articles, which are in-depth articles about important events",
      inputSchema: {
        lang: z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']).optional().describe("Language filter (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang = 'fr' }) => {
      const content = await searchAndFormat(apicore, {
        product: ['news'],
        lang: [lang],
        size: 15,
        sortOrder: 'desc',
        genreid: ['afpattribute:Article']
      }, false);
      return { content };
    }
  );

  server.registerTool("trending-topics",
    {
      description: "Get the most trending AFP news topics right now",
      inputSchema: {
        lang: z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']).optional().describe("Language filter (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang = 'fr' }) => {
      const result = await apicore.list('slug', {
        lang: [lang],
        product: ['news'],
        dateFrom: 'now-1d'
      }, 20);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
  );

  server.registerTool("topic-summary",
    {
      description: "Get the latest articles from an AFP Stories topic or rubric, which are editorially curated collections of articles on a specific theme",
      inputSchema: {
        topic: topicEnum.describe("AFP Stories topic identifier (e.g. 'ONLINE-NEWS-FR_LA-UNE', 'ONLINE-NEWS-EN_TOP-STORIES-INT')")
      }
    },
    async ({ topic }) => {
      const content = await searchAndFormat(apicore, {
        product: ['multimedia'],
        topic: [topic],
        size: 15,
        sortOrder: 'desc',
        genreid: GENRE_EXCLUSIONS
      }, false);
      return { content };
    }
  );
}
