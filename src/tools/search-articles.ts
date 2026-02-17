import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import {
  DEFAULT_FIELDS,
  GENRE_EXCLUSIONS,
  textContent,
  toolError,
  truncateIfNeeded,
  buildPaginationLine,
} from '../utils/format.js';
import { DEFAULT_SEARCH_SIZE } from '../utils/types.js';
import type { TextContent } from '../utils/types.js';
import {
  SEARCH_PRESETS,
  formatErrorMessage,
  formatDocuments,
  langEnum,
  searchPresetEnum,
} from './shared.js';

export const afpSearchArticlesTool = {
  name: 'afp_search_articles',
  title: 'Search AFP News Articles',
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
  inputSchema: z.object({
    preset: searchPresetEnum.optional().describe('Optional preset that applies predefined AFP filters. Available presets: a-la-une, agenda, previsions, major-stories.'),
    fullText: z.boolean().optional().describe('When true, returns the full article body. Default is false. If omitted and a preset is used, fullText defaults to true.'),
    query: z.string().optional().describe("List of keywords to search for in the news articles (e.g. 'climate change'), in the language specified by the 'lang' parameter. If not specified, the search will be performed in all languages. Do not use keywords in multiple languages."),
    lang: langEnum.array().optional().describe("Language of the news articles (e.g. 'en', 'fr'). Always use 'en' if you look for photos."),
    dateFrom: z.string().optional().describe("Start date for the search in ISO format (e.g. '2023-01-01') or relative (e.g. 'now-1d')"),
    dateTo: z.string().optional().describe("End date for the search in ISO format (e.g. '2023-12-31')"),
    size: z.number().optional().describe('Number of results to return (default 10, max 1000)'),
    sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
    offset: z.number().optional().describe('Offset for pagination (number of results to skip)'),
    country: z.string().array().optional().describe("Country filter (e.g. 'fra', 'usa')"),
    slug: z.string().array().optional().describe("Topic/slug filter (e.g. 'economy', 'sports')"),
    product: z.enum(['news', 'factcheck', 'photo', 'video', 'multimedia', 'graphic', 'videographic']).array().optional().describe("Content type filter (default ['news', 'factcheck'])"),
  }),
  handler: async (
    apicore: ApiCore,
    { preset, fullText = false, query, lang, dateFrom, dateTo, size = DEFAULT_SEARCH_SIZE, sortOrder = 'desc', offset, country, slug, product = ['news', 'factcheck'] }: any,
  ) => {
    try {
      let request: Record<string, unknown> = {
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
        genreid: GENRE_EXCLUSIONS,
      };

      if (preset) {
        request = { ...request, ...SEARCH_PRESETS[preset as keyof typeof SEARCH_PRESETS] };
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
  },
};
