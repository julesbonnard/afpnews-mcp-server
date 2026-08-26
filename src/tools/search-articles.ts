import { z } from 'zod';
import type { ApiCore, SearchQueryParams } from 'afpnews-api';
import {
  MARKDOWN_API_FIELDS,
  textContent,
  toolError,
  buildPaginationLine,
  formatDocumentOutput,
  toApiFields,
} from '../utils/format.js';
import { DEFAULT_SEARCH_SIZE, DEFAULT_OUTPUT_FIELDS } from '../utils/types.js';
import type { DocField } from '../utils/types.js';
import {
  SEARCH_PRESETS,
  GENRE_EXCLUSIONS,
  formatErrorMessage,
  searchPresetEnum,
  outputFormatEnum,
  docFieldEnum,
  facetParamValueSchema,
  UNO_FORMAT_NOTE,
} from './shared.js';

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
  fields: docFieldEnum.array().optional().describe('Fields to include in json/csv output. Default: uno, headline, lang, genre.'),
  fullText: z.boolean().optional().describe('When true, returns the full article body (markdown only). Default is false. Presets override to true.'),
  query: z.string().optional().describe("List of keywords to search for in the news articles (e.g. 'climate change'). If not specified, the search will be performed in all languages."),
  size: z.number().optional().describe('Number of results to return (default 10, max 1000)'),
  sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
  offset: z.number().optional().describe('Offset for pagination (number of results to skip)'),
  facets: z.record(z.string(), facetParamValueSchema).optional().describe("Facet filters passed to the AFP query (e.g. { langs: ['fr'], dateFrom: '2026-01-01', dateTo: '2026-01-31', country: ['usa'], genre: 'Papier général', urgency: 1 })."),
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
  description: `Search AFP news articles with filters and presets. This is the primary query tool for AFP news search.

Prefer this tool over afp_search_media unless the user explicitly asks for photos, videos, graphics, or motion design.

${UNO_FORMAT_NOTE}

Args:
  - preset: Optional predefined filter set (a-la-une, agenda, previsions, major-stories)
  - format: Output format — markdown (default), json, or csv. json/csv omit article body text.
  - fields: Fields to include in json/csv output (default: uno, headline, lang, genre).
            Available: uno, headline, lang, genre, afpshortid, published, status, signal, advisory, country, city, slug, class, event, revision, created.
  - fullText: Return full article body (true) or excerpt only (false, default). Only applies to markdown. Presets override to true.
  - query: Search keywords (e.g. 'climate change')
  - size: Number of results (default 10, max 1000)
  - sortOrder: 'asc' or 'desc' by date (default 'desc')
  - offset: Pagination offset (number of results to skip)
  - facets: All facet filters as key/value pairs (e.g. { langs: ['en'], dateFrom: '2026-01-01', dateTo: '2026-01-31', country: ['usa'], genre: 'Papier général', urgency: 1 }).
           Defaults: class=text, provider=afp, langs=fr. Override langs for other languages (e.g. { langs: ['en'] } or { langs: ['fr', 'en'] }).

Pagination:
  Use \`offset\` to paginate through results (e.g. offset=10 to skip the first 10).
  For large chronological scans, prefer narrowing \`dateFrom\`/\`dateTo\` ranges over high offsets.
  Keep \`size\` small (10–20) for best performance.

Returns:
  - markdown: Pagination summary line + formatted articles with headline, metadata, body
  - json: { total, shown, offset, truncated, remaining, documents: [...] } with selected fields
  - csv: Header row + data rows with selected fields

Examples:
  - Latest Ukraine news: { query: "Ukraine", facets: { langs: ["en"] }, size: 5 }
  - French front page: { preset: "a-la-une" }
  - Export metadata as CSV: { query: "economy", format: "csv", fields: ["uno", "headline", "country"] }`,
  inputSchema,
  handler: async (
    apicore: Pick<ApiCore, 'search'>,
    { preset, format = 'markdown', fields, fullText = false, query, size = DEFAULT_SEARCH_SIZE, sortOrder = 'desc', offset, facets }: SearchInput,
  ) => {
    try {
      const facetFilters = {
        class: ['text'],
        provider: ['afp'],
        langs: ['fr'],
        genreid: GENRE_EXCLUSIONS,
        ...(facets ?? {}),
      };

      let request: SearchQueryParams = {
        query,
        size,
        sortOrder,
        startAt: offset,
        ...facetFilters,
      };

      if (preset) {
        request = { ...request, ...SEARCH_PRESETS[preset] };
      }
      const effectiveFullText = preset ? true : fullText;

      const outputFields: DocField[] = fields ?? [...DEFAULT_OUTPUT_FIELDS];
      const apiFields = format === 'markdown'
        ? [...MARKDOWN_API_FIELDS]
        : toApiFields(outputFields);

      const { documents, count } = await apicore.search(request, apiFields, { parse: true, lenient: true });
      if (count === 0) {
        return { content: [textContent('No results found.')] };
      }

      const currentOffset = offset ?? 0;

      return formatDocumentOutput(documents, format, {
        fields: outputFields,
        fullText: effectiveFullText,
        jsonMeta: { total: count, offset: currentOffset },
        markdownPrefix: (shown) => [textContent(buildPaginationLine(shown, count, currentOffset))],
      });
    } catch (error) {
      return toolError(formatErrorMessage('searching AFP articles', error, 'Check your query parameters and try again.'));
    }
  },
};
