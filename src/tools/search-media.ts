import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import { textContent, toolError, TRUNCATION_HINT, buildPaginationLine } from '../utils/format.js';
import {
  formatMediaDocument,
  formatMediaDocumentsAsJson,
  formatMediaDocumentsAsCsv,
  extractRenditions,
} from '../utils/format-media.js';
import type { AFPMediaDocument } from '../utils/types.js';
import { DEFAULT_SEARCH_SIZE } from '../utils/types.js';
import {
  mediaClassEnum,
  outputFormatEnum,
  formatErrorMessage,
  facetParamValueSchema,
} from './shared.js';

const reservedMediaFacetKeys = new Set(['class', 'format', 'query', 'size', 'sortOrder', 'offset', 'facets']);

const MEDIA_API_FIELDS = [
  'uno', 'title', 'caption', 'creditLine', 'creator',
  'country', 'city', 'published', 'urgency', 'class',
  'aspectRatios', 'advisory', 'bagItem',
] as const;

const inputSchema = z.object({
  class: mediaClassEnum.optional().describe("Media class filter: 'picture' (photos), 'video', 'graphic' (infographics), or 'videography' (motion design). Omit to search all media types."),
  query: z.string().optional().describe("Search keywords (e.g. 'football london')"),
  size: z.number().optional().describe('Number of results (default 10, max 1000)'),
  offset: z.number().optional().describe('Pagination offset'),
  sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
  format: outputFormatEnum.optional().describe('Output format: markdown (default), json, or csv'),
  facets: z.record(z.string(), facetParamValueSchema).optional().describe(
    "Additional AFP facet filters (e.g. { lang: ['fr'], country: ['fra'], dateFrom: '2026-01-01' })"
  ),
}).strict().superRefine((value, ctx) => {
  for (const key of Object.keys(value.facets ?? {})) {
    if (reservedMediaFacetKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['facets', key],
        message: `Facet key "${key}" is reserved and must be provided at top-level.`,
      });
    }
  }
});

type SearchMediaInput = z.infer<typeof inputSchema>;

function buildMediaDocument(raw: any): AFPMediaDocument {
  return {
    uno: raw.uno,
    title: raw.title,
    caption: Array.isArray(raw.caption) ? raw.caption[0] : raw.caption,
    creditLine: raw.creditLine,
    creator: raw.creator,
    country: raw.country,
    city: raw.city,
    published: raw.published,
    urgency: raw.urgency,
    class: raw.class,
    aspectRatios: raw.aspectRatios,
    advisory: raw.advisory,
    renditions: extractRenditions(raw.bagItem ?? []),
  };
}

export const afpSearchMediaTool = {
  name: 'afp_search_media',
  title: 'Search AFP Media (Photos, Videos, Graphics)',
  description: `Search AFP media documents: photos, videos, infographics, and motion design.

Media classes:
  - picture: AFP photos. Captions are always in English — do not filter by lang, or use lang=en.
  - video: AFP video clips. No language constraint.
  - graphic: AFP infographics. Available in multiple languages — filter by lang if needed.
  - videography: AFP motion design (vidéographie). Available in multiple languages — filter by lang if needed.

Args:
  - class: 'picture', 'video', 'graphic', or 'videography' (omit to search all media types)
  - query: Search keywords
  - size: Number of results (default 10)
  - offset: Pagination offset
  - sortOrder: 'asc' or 'desc' (default 'desc')
  - format: markdown (default, with inline thumbnails), json (structured with rendition URLs), csv
  - facets: Additional AFP filters (e.g. { lang: ['fr'], country: ['fra'], dateFrom: '2026-01-01' })

Returns (json):
  { total, shown, offset, truncated, documents: [{ uno, title, caption, creditLine, creator,
    country, city, published, urgency, class, aspectRatios, advisory,
    renditions: { thumbnail, preview, highdef } }] }

Rendition sizes:
  - thumbnail: ~320px wide (gallery grid)
  - preview: ~1200px wide (display)
  - highdef: ~3400px wide (download / analysis)

Examples:
  - AFP football photos: { class: "picture", query: "football" }
  - French infographics on economy: { class: "graphic", query: "économie", facets: { lang: ["fr"] } }
  - All media on a topic: { query: "climate protest", format: "json" }
  - Export gallery CSV: { class: "picture", query: "Paris", format: "csv" }`,
  inputSchema,
  handler: async (
    apicore: ApiCore,
    { class: mediaClass, query, size = DEFAULT_SEARCH_SIZE, offset, sortOrder = 'desc', format = 'markdown', facets }: SearchMediaInput,
  ) => {
    try {
      const classFilter = mediaClass ? [mediaClass] : ['picture', 'video', 'graphic', 'videography'];
      const request: Record<string, unknown> = {
        query,
        size,
        sortOrder,
        startAt: offset,
        class: classFilter,
        ...(facets ?? {}),
      };

      const { documents: rawDocs, count } = await apicore.search(request as any, [...MEDIA_API_FIELDS]);

      if (count === 0) {
        return { content: [textContent('No results found.')] };
      }

      const docs = (rawDocs as any[]).map(buildMediaDocument);
      const currentOffset = offset ?? 0;

      if (format === 'json') {
        const { content, truncated } = formatMediaDocumentsAsJson(docs, { total: count, offset: currentOffset });
        const result = [content];
        if (truncated) result.push(textContent(TRUNCATION_HINT));
        return { content: result };
      }

      if (format === 'csv') {
        const { content, truncated } = formatMediaDocumentsAsCsv(docs);
        const result = [content];
        if (truncated) result.push(textContent(TRUNCATION_HINT));
        return { content: result };
      }

      // markdown
      const items = docs.map(formatMediaDocument);
      return {
        content: [
          textContent(buildPaginationLine(docs.length, count, currentOffset)),
          ...items,
        ],
      };
    } catch (error) {
      return toolError(formatErrorMessage('searching AFP media', error, 'Check your query parameters and try again.'));
    }
  },
};
