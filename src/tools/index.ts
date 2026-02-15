import { z } from 'zod';
import { ServerContext } from '../server.js';
import { formatDocument, DEFAULT_FIELDS, GENRE_EXCLUSIONS } from '../utils/format.js';

const SEARCH_PRESET_VALUES = ['a-la-une', 'agenda', 'previsions', 'major-stories'] as const;
const searchPresetEnum = z.enum(SEARCH_PRESET_VALUES);
const LIST_PRESET_VALUES = ['trending-topics'] as const;
const listPresetEnum = z.enum(LIST_PRESET_VALUES);

export function registerTools({ server, apicore }: ServerContext) {
  server.registerTool("search",
    {
      description: "Primary AFP query tool. Use this for all search use cases. Supports optional presets (a-la-une, agenda, previsions, major-stories). By default, returns only an excerpt (first paragraphs), unless FULL_TEXT is enabled.",
      inputSchema: {
        preset: searchPresetEnum.optional().describe("Optional preset that applies predefined AFP filters. Available presets: a-la-une, agenda, previsions, major-stories."),
        fullText: z.boolean().optional().describe("When true, returns the full article body. Default is false. If omitted and a preset is used, fullText defaults to true."),
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
    async ({ preset, fullText = false, query, lang, dateFrom, dateTo, size = 10, sortOrder = 'desc', offset, country, slug, product = ['news', 'factcheck'] }) => {
      let request: any = {
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
      };

      if (preset === 'a-la-une') {
        request = {
          ...request,
          product: ['news'],
          lang: ['fr'],
          slug: ['afp', 'actualites'],
          dateFrom: 'now-1d',
          size: 1,
          genreid: GENRE_EXCLUSIONS
        };
        fullText = true;
      } else if (preset === 'agenda') {
        request = {
          ...request,
          product: ['news'],
          size: 5,
          genreid: ['afpattribute:Agenda']
        };
        fullText = true;
      } else if (preset === 'previsions') {
        request = {
          ...request,
          product: ['news'],
          size: 5,
          genreid: ['afpattribute:Program', 'afpedtype:TextProgram']
        };
        fullText = true;
      } else if (preset === 'major-stories') {
        request = {
          ...request,
          product: ['news'],
          genreid: ['afpattribute:Article']
        };
        fullText = true;
      }

      const { documents, count } = await apicore.search(request, [...DEFAULT_FIELDS]);
      if (count === 0) {
        return { content: [{ type: 'text' as const, text: 'No results found.' }] };
      }
      return {
        content: documents.map((doc: unknown) => formatDocument(doc, fullText))
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
      description: "List facet values and their counts. Supports optional preset `trending-topics`.",
      inputSchema: {
        preset: listPresetEnum.optional().describe("Optional preset for list queries. Available preset: trending-topics."),
        facet: z.string().optional().describe("Facet to list (e.g. 'slug', 'genre', 'country'). Required when no preset is used."),
        lang: z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']).optional().describe("Language filter (e.g. 'en', 'fr')"),
        size: z.number().optional().describe("Number of facet values to return")
      }
    },
    async ({ preset, facet, lang, size }) => {
      let resolvedFacet = facet;
      let params: any = {};
      let resolvedSize = size;

      if (preset === 'trending-topics') {
        resolvedFacet = 'slug';
        params = {
          langs: [lang ?? 'fr'],
          product: ['news'],
          dateFrom: 'now-1d'
        };
        resolvedSize = size ?? 20;
      } else {
        if (!resolvedFacet) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Missing required parameter: facet (or provide preset: trending-topics).'
            }]
          };
        }
        if (lang) params.langs = [lang];
      }

      const result = await apicore.list(resolvedFacet, params, resolvedSize);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result, null, 2)
        }]
      };
    }
  );
}
