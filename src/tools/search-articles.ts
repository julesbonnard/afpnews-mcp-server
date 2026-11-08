import { z } from 'zod';
import type { AfpDocument, ApiCore, SearchQueryParams } from 'afpnews-api';
import {
  MARKDOWN_API_FIELDS,
  textContent,
  toolError,
  buildPaginationLine,
  formatDocumentOutput,
  toApiFields,
} from '../utils/format.js';
import { DEFAULT_SEARCH_SIZE, DEFAULT_OUTPUT_FIELDS } from '../utils/config.js';
import type { DocField } from '../utils/types.js';
import {
  SEARCH_PRESETS,
  AGENDA_GENRE_EXCLUSIONS,
  formatErrorMessage,
  searchPresetEnum,
  outputFormatEnum,
  docFieldEnum,
  facetParamValueSchema,
  UNO_FORMAT_NOTE,
  PARAGRAPH_MARKER_NOTE,
  REGION_FACET_NOTE,
  UNO_FACET_NOTE,
  AFP_PROVIDERS,
  requestedUnos,
} from './shared.js';
import { formatPassages, passagesSchema, PASSAGES_NOTE } from '../utils/passages.js';

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
  'passages',
]);

const inputSchema = z.object({
  preset: searchPresetEnum.optional().describe('Predefined AFP filter set.'),
  format: outputFormatEnum.optional().describe('Output format: markdown (default, with article body), json (structured, no body), csv (tabular, no body).'),
  fields: docFieldEnum.array().optional().describe('Fields to include in json/csv output. Default: uno, headline, lang, genre.'),
  fullText: z.boolean().optional().describe('Return the full article body (markdown only). Default false, true with a preset.'),
  query: z.string().optional().describe('Search keywords (AFP query syntax: AND, OR, quotes, title:).'),
  size: z.number().optional().describe('Number of results to return (default 10, or the number of facets.uno; max 1000)'),
  sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
  offset: z.number().optional().describe('Offset for pagination (number of results to skip)'),
  facets: z.record(z.string(), facetParamValueSchema).optional().describe(`Facet filters: langs, dateFrom, dateTo, country, genre, slug, event, urgency, class… ${REGION_FACET_NOTE} ${UNO_FACET_NOTE}`),
  passages: passagesSchema.optional().describe(`${PASSAGES_NOTE} Markdown only.`),
}).strict().superRefine((value, ctx) => {
  for (const key of Object.keys(value.facets ?? {})) {
    if (reservedFacetKeys.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['facets', key],
        message: `Facet key "${key}" is reserved and must be provided at top-level.`,
      });
    }
  }
});

type SearchInput = z.infer<typeof inputSchema>;

// The same story exists as text and multimedia (same afpshortid, different UNO), not always updated together.
export function latestPerShortId(documents: AfpDocument[]): AfpDocument[] {
  const latest = new Map<string, AfpDocument>();
  for (const doc of documents) {
    const key = doc.shortId ?? doc.uno;
    const kept = latest.get(key);
    if (!kept || doc.published > kept.published) latest.set(key, doc);
  }
  return documents.filter((doc) => latest.get(doc.shortId ?? doc.uno) === doc);
}

export const afpSearchArticlesTool = {
  name: 'afp_search_articles',
  title: 'Search AFP News Articles',
  description: `Search AFP news articles (text). The primary search tool: use afp_search_media only for photos, videos, graphics or motion design.

Set facets.langs: without it, results mix all languages. Defaults: class=text and multimedia (a story in both is returned once, in its latest version), provider=AFP (including its Arabic service). Agenda items are excluded unless a preset asks for them. Results are sorted by date, never by relevance. Paginate with offset; for long chronological scans, narrow dateFrom/dateTo rather than raising offset.

${UNO_FORMAT_NOTE}

${PARAGRAPH_MARKER_NOTE}`,
  inputSchema,
  handler: async (
    apicore: Pick<ApiCore, 'search'>,
    { preset, format = 'markdown', fields, fullText = false, query, size, sortOrder = 'desc', offset, facets, passages }: SearchInput,
  ) => {
    try {
      if (passages && format !== 'markdown') {
        return toolError(`passages is only supported with format: "markdown" (got "${format}").`);
      }
      const unos = requestedUnos(facets);
      const facetFilters = {
        ...(!unos && {
          class: ['text', 'multimedia'],
          provider: AFP_PROVIDERS,
          genreid: AGENDA_GENRE_EXCLUSIONS,
        }),
        ...(facets ?? {}),
      };

      let request: SearchQueryParams = {
        query,
        size: size ?? unos?.length ?? DEFAULT_SEARCH_SIZE,
        sortOrder,
        startAt: offset,
        ...facetFilters,
      };

      if (preset) {
        request = { ...request, ...SEARCH_PRESETS[preset] };
      }
      const effectiveFullText = preset ? true : fullText;

      const outputFields: DocField[] = fields ?? [...DEFAULT_OUTPUT_FIELDS];
      const apiFields = [
        ...(format === 'markdown' ? MARKDOWN_API_FIELDS : toApiFields(outputFields)),
        'afpshortid',
      ];

      const { documents, count } = await apicore.search(request, apiFields, { parse: true, lenient: true });
      if (count === 0) {
        return { content: [textContent('No results found.')] };
      }

      const currentOffset = offset ?? 0;
      const unique = latestPerShortId(documents);
      const merged = documents.length - unique.length;
      // offset counts raw API results: resume after the last shown document, duplicates included.
      const rawShown = (shown: number) =>
        shown === unique.length ? documents.length : documents.indexOf(unique[shown - 1]!) + 1;
      const mergedNote = merged ? ` ${merged} duplicate(s) (same story in text and multimedia) merged, keeping the latest version.` : '';

      if (passages) {
        const pagination = buildPaginationLine(documents.length, count, currentOffset) + mergedNote;
        return { content: [textContent(`${pagination}\n\n${formatPassages(unique, passages)}`)] };
      }

      return formatDocumentOutput(unique, format, {
        fields: outputFields,
        fullText: effectiveFullText,
        jsonMeta: { total: count, offset: currentOffset, ...(merged && { duplicatesMerged: merged, nextOffset: currentOffset + documents.length }) },
        markdownPrefix: (shown) => [textContent(buildPaginationLine(rawShown(shown), count, currentOffset) + mergedNote)],
      });
    } catch (error) {
      return toolError(formatErrorMessage('searching AFP articles', error, 'Check your query parameters and try again.'));
    }
  },
};
