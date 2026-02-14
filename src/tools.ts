import { z } from 'zod';
import { ServerContext } from './context.js';
import { formatDocument, GENRE_EXCLUSIONS } from './format.js';
import { TOPICS } from './topics.js';

const ALL_TOPIC_VALUES = Object.values(TOPICS).flat().map(t => t.value);
const topicEnum = z.enum(ALL_TOPIC_VALUES as [string, ...string[]]);

export function registerTools({ server, apicore }: ServerContext) {
  server.registerTool("search",
    {
      description: "Search AFP news articles",
      inputSchema: {
        query: z.string().optional().describe("List of keywords to search for in the news articles (e.g. 'climate change'), in the language specified by the 'lang' parameter. If not specified, the search will be performed in all languages. Do not use keywords in multiple languages."),
        langs: z.string().array().optional().describe("Language of the news articles (e.g. 'en', 'fr')"),
        dateFrom: z.string().optional().describe("Start date for the search in ISO format (e.g. '2023-01-01')"),
        dateTo: z.string().optional().describe("End date for the search in ISO format (e.g. '2023-12-31')"),
        size: z.number().optional().describe("Number of results to return (default 10, max 1000)"),
        sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
        offset: z.number().optional().describe("Offset for pagination (number of results to skip)"),
        country: z.string().array().optional().describe("Country filter (e.g. 'fra', 'usa')"),
        slug: z.string().array().optional().describe("Topic/slug filter (e.g. 'economy', 'sports')"),
        products: z.enum(['news', 'factcheck', 'photo', 'video', 'multimedia', 'graphic', 'videographic']).optional().describe("Content type filter (default ['news', 'factcheck'])")
      }
    },
    async ({ query, langs, dateFrom, dateTo, size, sortOrder, offset, country, slug, products = ['news', 'factcheck'] }) => {
      const { documents, count } = await apicore.search({
        query,
        langs,
        products,
        dateFrom,
        dateTo,
        size,
        sortOrder,
        startAt: offset,
        country,
        slug,
        genreid: GENRE_EXCLUSIONS // Exclude certain genres that are not relevant for news articles
      }, ['uno', 'published', 'headline', 'news', 'lang', 'genre']);
      if (count === 0) {
        throw new Error('No results found');
      }
      return {
        content: documents.map(doc => formatDocument(doc, false))
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
        lang: z.string().describe("Language for results (e.g. 'en', 'fr')"),
        size: z.number().optional().describe("Number of similar articles to return (default 10)")
      }
    },
    async ({ uno, lang, size }) => {
      const { documents, count } = await apicore.mlt(uno, lang, size);
      if (count === 0) {
        throw new Error('No similar articles found');
      }
      return {
        content: documents.map((doc: any) => formatDocument(doc, false))
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
      const { documents } = await apicore.search({
        products: ['news'],
        langs: ['fr'],
        slug: ['afp', 'actualites'],
        dateFrom: 'now-1d',
        size: 15,
        sortOrder: 'desc',
        genreid: GENRE_EXCLUSIONS
      }, ['uno', 'published', 'headline', 'news', 'lang', 'genre']);
      return {
        content: documents.map(doc => formatDocument(doc, false))
      };
    }
  );

  server.registerTool("agenda",
    {
      description: "Get upcoming scheduled events and press releases from AFP",
      inputSchema: {
        lang: z.string().optional().describe("Language filter (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang }) => {
      const { documents } = await apicore.search({
        products: ['news'],
        langs: [lang || 'fr'],
        size: 15,
        sortOrder: 'desc',
        genreid: ['afpattribute:Agenda']
      }, ['uno', 'published', 'headline', 'news', 'lang', 'genre']);
      return {
        content: documents.map(doc => formatDocument(doc, false))
      };
    }
  );

  server.registerTool("previsions",
    {
      description: "Get AFP editorial coverage plans — stories scheduled to be published soon",
      inputSchema: {
        lang: z.string().optional().describe("Language filter (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang }) => {
      const { documents } = await apicore.search({
        products: ['news'],
        langs: [lang || 'fr'],
        size: 15,
        sortOrder: 'desc',
        genreid: ['afpattribute:Program', 'afpedtype:TextProgram']
      }, ['uno', 'published', 'headline', 'news', 'lang', 'genre']);
      return {
        content: documents.map(doc => formatDocument(doc, false))
      };
    }
  );

  server.registerTool("major-stories",
    {
      description: "Get the latest AFP major news articles",
      inputSchema: {
        lang: z.string().optional().describe("Language filter (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang }) => {
      const { documents } = await apicore.search({
        products: ['news'],
        langs: [lang || 'fr'],
        size: 15,
        sortOrder: 'desc',
        genreid: ['afpattribute:Article']
      }, ['uno', 'published', 'headline', 'news', 'lang', 'genre']);
      return {
        content: documents.map(doc => formatDocument(doc, false))
      };
    }
  );

  server.registerTool("trending-topics",
    {
      description: "Get the most trending AFP news topics right now",
      inputSchema: {
        lang: z.string().optional().describe("Language filter (e.g. 'en', 'fr'). Default: 'fr'")
      }
    },
    async ({ lang }) => {
      const result = await apicore.list('slug', {
        langs: [lang || 'fr'],
        products: ['news'],
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
      description: "Get the latest articles from an AFP Stories topic section",
      inputSchema: {
        topic: topicEnum.describe("AFP Stories topic identifier (e.g. 'ONLINE-NEWS-FR_LA-UNE', 'ONLINE-NEWS-EN_TOP-STORIES-INT')")
      }
    },
    async ({ topic }) => {
      const { documents } = await apicore.search({
        products: [topic],
        size: 15,
        sortOrder: 'desc',
        genreid: GENRE_EXCLUSIONS
      }, ['uno', 'published', 'headline', 'news', 'lang', 'genre']);
      return {
        content: documents.map(doc => formatDocument(doc, false))
      };
    }
  );
}
