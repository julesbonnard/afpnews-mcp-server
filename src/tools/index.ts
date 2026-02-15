import { z } from 'zod';
import { ServerContext } from '../server.js';
import {
  formatDocument, DEFAULT_FIELDS, GENRE_EXCLUSIONS,
  textContent, toolError, truncateIfNeeded, buildPaginationLine
} from '../utils/format.js';
import { getTopicLabel } from '../utils/topics.js';
import { DEFAULT_SEARCH_SIZE, DEFAULT_FACET_SIZE } from '../utils/types.js';
import type { TextContent } from '../utils/types.js';

const SEARCH_PRESET_VALUES = ['a-la-une', 'agenda', 'previsions', 'major-stories'] as const;
const searchPresetEnum = z.enum(SEARCH_PRESET_VALUES);
type SearchPreset = z.infer<typeof searchPresetEnum>;

const LIST_PRESET_VALUES = ['trending-topics'] as const;
const listPresetEnum = z.enum(LIST_PRESET_VALUES);

const langEnum = z.enum(['en', 'fr', 'de', 'pt', 'es', 'ar']);

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

interface FacetResult {
  key: string;
  count: number;
}

interface PresetOverrides {
  product?: string[];
  lang?: string[];
  slug?: string[];
  dateFrom?: string;
  size?: number;
  genreid?: Record<string, string[]> | string[];
}

const SEARCH_PRESETS: Record<SearchPreset, PresetOverrides> = {
  'a-la-une': {
    product: ['news'],
    lang: ['fr'],
    slug: ['afp', 'actualites'],
    dateFrom: 'now-1d',
    size: 1,
    genreid: GENRE_EXCLUSIONS,
  },
  'agenda': {
    product: ['news'],
    size: 5,
    genreid: ['afpattribute:Agenda'],
  },
  'previsions': {
    product: ['news'],
    size: 5,
    genreid: ['afpattribute:Program', 'afpedtype:TextProgram'],
  },
  'major-stories': {
    product: ['news'],
    genreid: ['afpattribute:Article'],
  },
};

function formatErrorMessage(context: string, error: unknown, hint: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Error ${context}: ${message}. ${hint}`;
}

function formatDocuments(documents: unknown[], fullText: boolean): TextContent[] {
  return documents.map((doc) => formatDocument(doc, fullText));
}

export function registerTools({ server, apicore }: ServerContext) {
  server.registerTool("afp_search_articles",
    {
      title: "Search AFP News Articles",
      description: `Search AFP news articles with filters and presets. This is the primary query tool for all AFP news search use cases.

Args:
  - preset: Optional predefined filter set (a-la-une, agenda, previsions, major-stories)
  - fullText: Return full article body (true) or excerpt only (false, default). Presets override to true.
  - query: Search keywords in the language specified by 'lang' (e.g. 'climate change')
  - lang: Article language filter (e.g. ['en', 'fr']). Use ['en'] for photos.
  - dateFrom/dateTo: Date range in ISO format (e.g. '2025-01-01') or relative ('now-1d')
  - size: Number of results (default 10, max 1000)
  - sortOrder: 'asc' or 'desc' by date (default 'desc')
  - offset: Pagination offset (number of results to skip)
  - country: Country code filter (e.g. ['fra', 'usa'])
  - slug: Topic/slug filter (e.g. ['economy', 'sports'])
  - product: Content type filter (default ['news', 'factcheck'])

Returns:
  Pagination summary line, followed by markdown-formatted articles:
  - ## Headline
  - *UNO | Published date | Lang | Genre*
  - Article body (excerpt or full text)

Examples:
  - Latest Ukraine news: { query: "Ukraine", lang: ["en"], size: 5 }
  - French front page: { preset: "a-la-une" }
  - Recent photos: { product: ["photo"], lang: ["en"], size: 5 }
  - Page 2 of results: { query: "economy", size: 10, offset: 10 }`,
      inputSchema: {
        preset: searchPresetEnum.optional().describe("Optional preset that applies predefined AFP filters. Available presets: a-la-une, agenda, previsions, major-stories."),
        fullText: z.boolean().optional().describe("When true, returns the full article body. Default is false. If omitted and a preset is used, fullText defaults to true."),
        query: z.string().optional().describe("List of keywords to search for in the news articles (e.g. 'climate change'), in the language specified by the 'lang' parameter. If not specified, the search will be performed in all languages. Do not use keywords in multiple languages."),
        lang: langEnum.array().optional().describe("Language of the news articles (e.g. 'en', 'fr'). Always use 'en' if you look for photos."),
        dateFrom: z.string().optional().describe("Start date for the search in ISO format (e.g. '2023-01-01') or relative (e.g. 'now-1d')"),
        dateTo: z.string().optional().describe("End date for the search in ISO format (e.g. '2023-12-31')"),
        size: z.number().optional().describe("Number of results to return (default 10, max 1000)"),
        sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
        offset: z.number().optional().describe("Offset for pagination (number of results to skip)"),
        country: z.string().array().optional().describe("Country filter (e.g. 'fra', 'usa')"),
        slug: z.string().array().optional().describe("Topic/slug filter (e.g. 'economy', 'sports')"),
        product: z.enum(['news', 'factcheck', 'photo', 'video', 'multimedia', 'graphic', 'videographic']).array().optional().describe("Content type filter (default ['news', 'factcheck'])")
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ preset, fullText = false, query, lang, dateFrom, dateTo, size = DEFAULT_SEARCH_SIZE, sortOrder = 'desc', offset, country, slug, product = ['news', 'factcheck'] }) => {
      try {
        let request: Record<string, unknown> = {
          query, lang, product, dateFrom, dateTo, size, sortOrder,
          startAt: offset, country, slug, genreid: GENRE_EXCLUSIONS,
        };

        if (preset) {
          request = { ...request, ...SEARCH_PRESETS[preset] };
          fullText = true;
        }

        const { documents, count } = await apicore.search(request as any, [...DEFAULT_FIELDS]);
        if (count === 0) {
          return { content: [textContent('No results found.')] };
        }

        const currentOffset = offset ?? 0;
        const content: TextContent[] = [
          textContent(buildPaginationLine(documents.length, count, currentOffset)),
          ...formatDocuments(documents, fullText),
        ];
        return { content: truncateIfNeeded(content) };
      } catch (error) {
        return toolError(formatErrorMessage('searching AFP articles', error, 'Check your query parameters and try again.'));
      }
    }
  );

  server.registerTool("afp_get_article",
    {
      title: "Get AFP Article",
      description: `Get a full AFP news article by its UNO identifier. Use this after searching to retrieve the complete text of a specific article.

Args:
  - uno: The unique identifier (UNO) of the article (e.g. 'NEWS-FR-123456-ABC')

Returns:
  Markdown-formatted full article:
  - ## Headline
  - *UNO | Published date | Lang | Genre*
  - Complete article body

Examples:
  - Get a specific article: { uno: "NEWS-FR-123456-ABC" }`,
      inputSchema: {
        uno: z.string().describe("The unique identifier (UNO) of the article"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ uno }) => {
      try {
        const doc = await apicore.get(uno);
        return { content: [formatDocument(doc, true)] };
      } catch (error) {
        return toolError(formatErrorMessage(`fetching article "${uno}"`, error, 'Verify the UNO identifier is correct.'));
      }
    }
  );

  server.registerTool("afp_find_similar",
    {
      title: "Find Similar AFP Articles",
      description: `Find AFP news articles similar to a given article (More Like This). Useful for exploring related coverage or finding follow-up stories.

Args:
  - uno: The UNO of the reference article to find similar content for
  - lang: Language for results (e.g. 'en', 'fr')
  - size: Number of similar articles to return (default 10)

Returns:
  Pagination summary, followed by markdown-formatted article excerpts:
  - ## Headline
  - *UNO | Published date | Lang | Genre*
  - Article excerpt (first paragraphs)

Examples:
  - Find similar articles in French: { uno: "NEWS-FR-123456-ABC", lang: "fr" }
  - Get 5 similar English articles: { uno: "NEWS-EN-789", lang: "en", size: 5 }`,
      inputSchema: {
        uno: z.string().describe("The UNO of the reference article"),
        lang: langEnum.describe("Language for results (e.g. 'en', 'fr')"),
        size: z.number().optional().describe("Number of similar articles to return (default 10)"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ uno, lang, size }) => {
      try {
        const { documents, count } = await apicore.mlt(uno, lang, size);
        if (count === 0) {
          return { content: [textContent('No similar articles found.')] };
        }

        const content: TextContent[] = [
          textContent(`*Found ${count} similar articles.*`),
          ...formatDocuments(documents, false),
        ];
        return { content: truncateIfNeeded(content) };
      } catch (error) {
        return toolError(formatErrorMessage(`finding similar articles for "${uno}"`, error, 'Verify the UNO identifier is correct.'));
      }
    }
  );

  server.registerTool("afp_list_facets",
    {
      title: "List AFP Facet Values",
      description: `List facet values and their article counts. Use this to discover available topics, genres, or countries, or to get trending topics.

Args:
  - preset: Optional preset (trending-topics) — overrides facet to 'slug' with last 24h news
  - facet: Facet to list (e.g. 'slug', 'genre', 'country'). Required when no preset is used.
  - lang: Language filter (e.g. 'en', 'fr')
  - size: Number of facet values to return

Returns:
  Markdown-formatted list of facet values with article counts:
  - **Label or key** — N articles

Examples:
  - Trending topics in French: { preset: "trending-topics" }
  - Trending topics in English: { preset: "trending-topics", lang: "en" }
  - List available genres: { facet: "genre" }
  - List countries: { facet: "country", size: 30 }`,
      inputSchema: {
        preset: listPresetEnum.optional().describe("Optional preset for list queries. Available preset: trending-topics."),
        facet: z.string().optional().describe("Facet to list (e.g. 'slug', 'genre', 'country'). Required when no preset is used."),
        lang: langEnum.optional().describe("Language filter (e.g. 'en', 'fr')"),
        size: z.number().optional().describe("Number of facet values to return"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ preset, facet, lang, size }) => {
      try {
        const isTrendingTopics = preset === 'trending-topics';
        const resolvedFacet = isTrendingTopics ? 'slug' : facet;

        if (!resolvedFacet) {
          return toolError("Missing required parameter: facet (e.g. 'slug', 'genre', 'country'). Alternatively, use preset: 'trending-topics'.");
        }

        const params: Record<string, unknown> = isTrendingTopics
          ? { langs: [lang ?? 'fr'], product: ['news'], dateFrom: 'now-1d' }
          : (lang ? { langs: [lang] } : {});

        const resolvedSize = isTrendingTopics ? (size ?? DEFAULT_FACET_SIZE) : size;

        const rawResult = await apicore.list(resolvedFacet, params as any, resolvedSize) as any;
        const results: FacetResult[] = rawResult?.keywords ?? rawResult ?? [];

        if (results.length === 0) {
          return { content: [textContent(`No facet values found for "${resolvedFacet}".`)] };
        }

        const heading = isTrendingTopics ? 'Trending Topics' : `Facet: ${resolvedFacet}`;
        const lines = results.map((item) => {
          const label = isTrendingTopics ? (getTopicLabel(item.key) ?? item.key) : item.key;
          return `- **${label}** — ${item.count} articles`;
        });

        return { content: [textContent(`## ${heading}\n\n${lines.join('\n')}`)] };
      } catch (error) {
        return toolError(formatErrorMessage('listing facet values', error, "Check that the facet name is valid (e.g. 'slug', 'genre', 'country')."));
      }
    }
  );
}
