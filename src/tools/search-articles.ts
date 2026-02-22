import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import {
  MARKDOWN_API_FIELDS,
  textContent,
  toolError,
  buildPaginationLine,
  formatDocumentOutput,
} from '../utils/format.js';
import { DEFAULT_SEARCH_SIZE, DEFAULT_OUTPUT_FIELDS } from '../utils/types.js';
import {
  SEARCH_PRESETS,
  GENRE_EXCLUSIONS,
  formatErrorMessage,
  searchPresetEnum,
  outputFormatEnum,
  docFieldEnum,
  UNO_FORMAT_NOTE,
} from './shared.js';

const facetParamValueSchema = z.union([
  z.string(),
  z.number(),
  z.string().array(),
  z.number().array(),
  z.object({
    in: z.union([z.string().array(), z.number().array()]).optional(),
    exclude: z.union([z.string().array(), z.number().array()]).optional(),
  }).refine((value) => value.in !== undefined || value.exclude !== undefined, {
    message: "Facet filter object must include either 'in' or 'exclude'.",
  }),
]);

const reservedFacetKeys = new Set([
  'preset',
  'format',
  'fields',
  'fullText',
  'query',
  'size',
  'sortOrder',
  'offset',
  'facets',
]);

const inputSchema = z.object({
  preset: searchPresetEnum.optional().describe('Optional preset that applies predefined AFP filters. Available presets: a-la-une, agenda, previsions, major-stories.'),
  format: outputFormatEnum.optional().describe('Output format: markdown (default, with article body), json (structured, no body), csv (tabular, no body).'),
  fields: docFieldEnum.array().optional().describe('Fields to include in json/csv output. Default: afpshortid, uno, headline, published, lang, genre.'),
  fullText: z.boolean().optional().describe('When true, returns the full article body (markdown only). Default is false. Presets override to true.'),
  query: z.string().optional().describe("List of keywords to search for in the news articles (e.g. 'climate change'). If not specified, the search will be performed in all languages."),
  size: z.number().optional().describe('Number of results to return (default 10, max 1000)'),
  sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
  offset: z.number().optional().describe('Offset for pagination (number of results to skip)'),
  facets: z.record(z.string(), facetParamValueSchema).optional().describe("Facet filters passed to the AFP query (e.g. { lang: ['fr'], dateFrom: '2026-01-01', dateTo: '2026-01-31', country: ['usa'], genre: 'Papier général', urgency: 1 })."),
}).strict().superRefine((value, ctx) => {
  for (const key of Object.keys(value.facets ?? {})) {
    if (reservedFacetKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['facets', key],
        message: `Facet key "${key}" is reserved and must be provided at top-level.`,
      });
    }
  }
});

type SearchInput = z.infer<typeof inputSchema>;

export const afpSearchArticlesTool = {
  name: 'afp_search_articles',
  title: 'Search AFP News Articles',
  description: `Search AFP news articles with filters and presets. This is the primary query tool for all AFP news search use cases.

${UNO_FORMAT_NOTE}

Args:
  - preset: Optional predefined filter set (a-la-une, agenda, previsions, major-stories)
  - format: Output format — markdown (default), json, or csv. json/csv omit article body text.
  - fields: Fields to include in json/csv output (default: uno, headline, lang, genre).
            Available: uno, headline, lang, genre, afpshortid, published, status, signal, advisory, country, city, slug, product, revision, created.
  - fullText: Return full article body (true) or excerpt only (false, default). Only applies to markdown. Presets override to true.
  - query: Search keywords (e.g. 'climate change')
  - size: Number of results (default 10, max 1000)
  - sortOrder: 'asc' or 'desc' by date (default 'desc')
  - offset: Pagination offset (number of results to skip)
  - facets: All facet filters as key/value pairs (e.g. { lang: ['fr'], dateFrom: '2026-01-01', dateTo: '2026-01-31', country: ['usa'], genre: 'Papier général', urgency: 1 })

Returns:
  - markdown: Pagination summary line + formatted articles with headline, metadata, body
  - json: { total, shown, offset, documents: [...] } with selected fields
  - csv: Header row + data rows with selected fields

Examples:
  - Latest Ukraine news: { query: "Ukraine", facets: { lang: ["en"] }, size: 5 }
  - French front page: { preset: "a-la-une" }
  - Export metadata as CSV: { query: "economy", format: "csv", fields: ["uno", "headline", "country"] }`,
  inputSchema,
  handler: async (
    apicore: ApiCore,
    { preset, format = 'markdown', fields, fullText = false, query, size = DEFAULT_SEARCH_SIZE, sortOrder = 'desc', offset, facets }: SearchInput,
  ) => {
    try {
      const facetFilters = {
        product: ['news', 'factcheck'],
        genreid: GENRE_EXCLUSIONS,
        ...(facets ?? {}),
      };

      let request: Record<string, unknown> = {
        query,
        size,
        sortOrder,
        startAt: offset,
        ...facetFilters,
      };

      if (preset) {
        request = { ...request, ...SEARCH_PRESETS[preset] };
        fullText = true;
      }

      const outputFields: string[] = fields ?? [...DEFAULT_OUTPUT_FIELDS];
      const apiFields = format === 'markdown'
        ? [...MARKDOWN_API_FIELDS]
        : [...new Set(['afpshortid', 'uno', ...outputFields])];

      const { documents, count } = await apicore.search(request as any, apiFields);
      if (count === 0) {
        return { content: [textContent('No results found.')] };
      }

      const currentOffset = offset ?? 0;

      return formatDocumentOutput(documents, format, {
        fields: outputFields,
        fullText,
        jsonMeta: { total: count, offset: currentOffset },
        markdownPrefix: [textContent(buildPaginationLine(documents.length, count, currentOffset))],
      });
    } catch (error) {
      return toolError(formatErrorMessage('searching AFP articles', error, 'Check your query parameters and try again.'));
    }
  },
};
