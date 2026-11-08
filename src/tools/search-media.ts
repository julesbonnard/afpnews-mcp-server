import { z } from 'zod';
import { toApiFields } from 'afpnews-api';
import type { ApiCore, SearchQueryParams } from 'afpnews-api';
import { textContent, toolError, buildPaginationLine } from '../utils/format.js';
import {
  formatMediaOutput,
  formatMediaDocument,
  normalizeMediaDocument,
} from '../utils/format-media.js';
import { DEFAULT_SEARCH_SIZE, EMBED_MAX_DOCS } from '../utils/config.js';
import type { AFPMediaDocument, AnyContent, MediaRendition } from '../utils/types.js';
import { selectRenditionForEmbed, isSvgRendition, embedRendition } from '../utils/embed-media.js';
import {
  mediaClassEnum,
  outputFormatEnum,
  formatErrorMessage,
  facetParamValueSchema,
  REGION_FACET_NOTE,
  UNO_FACET_NOTE,
  AFP_PROVIDERS,
  requestedUnos,
} from './shared.js';
import { formatPassages, passagesSchema, PASSAGES_NOTE } from '../utils/passages.js';

async function embedMediaDocuments(docs: AFPMediaDocument[]): Promise<AnyContent[]> {
  const content: AnyContent[] = [];

  for (const doc of docs) {
    content.push(formatMediaDocument(doc));

    const allRenditions = Object.values(doc.renditions).filter(Boolean) as MediaRendition[];
    if (doc.class === 'graphic' && allRenditions.some(isSvgRendition)) {
      content.push(textContent('_Warning: SVG graphics cannot be embedded for vision._'));
      continue;
    }

    const renditionKey = doc.class === 'video' || doc.class === 'videography' ? 'thumbnail' : 'quicklook';
    const chosen = selectRenditionForEmbed(doc.renditions, renditionKey);
    if (!chosen) continue;

    const embedded = await embedRendition(chosen);
    if (embedded.ok) content.push(embedded.image);
  }

  return content;
}

const reservedMediaFacetKeys = new Set(['class', 'format', 'query', 'size', 'sortOrder', 'offset', 'facets', 'passages']);

// Le socle requis par parseDocument() (class, urgency, created, ...) est injecté
// automatiquement par toApiFields() (SDK) — pas besoin de le lister ici.
const MEDIA_API_FIELDS = toApiFields([
  'title', 'caption', 'creditLine', 'creator',
  'country', 'city', 'aspectRatios', 'advisory', 'medias',
]);
const PASSAGES_API_FIELDS = toApiFields(['caption', 'shots', 'paragraphs', 'genre']);

const inputSchema = z.object({
  class: mediaClassEnum.optional().describe("Media class. Omit to search all media types."),
  query: z.string().optional().describe('Search keywords (AFP query syntax: AND, OR, quotes, title:).'),
  size: z.number().optional().describe('Number of results (default 10, or the number of facets.uno; max 1000)'),
  offset: z.number().optional().describe('Pagination offset'),
  sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order by date (default 'desc')"),
  format: outputFormatEnum.optional().describe('Output format: markdown (default), json (with rendition URLs), or csv'),
  facets: z.record(z.string(), facetParamValueSchema).optional().describe(
    `Facet filters: langs, dateFrom, dateTo, country, genre, event… ${REGION_FACET_NOTE} ${UNO_FACET_NOTE}`
  ),
  passages: passagesSchema.optional().describe(`${PASSAGES_NOTE} Videos only (shot lists); markdown only.`),
  embed: z.boolean().optional().describe(
    `Embed the lightest image of each result (video: poster frame) for vision, to compare candidates. Markdown only; size capped to ${EMBED_MAX_DOCS}.`
  ),
}).strict().superRefine((value, ctx) => {
  for (const key of Object.keys(value.facets ?? {})) {
    if (reservedMediaFacetKeys.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['facets', key],
        message: `Facet key "${key}" is reserved and must be provided at top-level.`,
      });
    }
  }
});

type SearchMediaInput = z.infer<typeof inputSchema>;

export const afpSearchMediaTool = {
  name: 'afp_search_media',
  title: 'Search AFP Media (Photos, Videos, Graphics)',
  description: `Search AFP media: photos (picture), videos, infographics (graphic) and motion design (videography). For news text, use afp_search_articles.

Photo captions are always in English: do not filter photos by lang. Videos have no language constraint; graphics and videography exist in several languages. Default provider: AFP (including its Arabic service). Results are sorted by date, never by relevance; paginate with offset.

Renditions: quicklook ~245px, thumbnail ~320px, preview ~1200px, highdef ~3400px.`,
  inputSchema,
  handler: async (
    apicore: Pick<ApiCore, 'search'>,
    { class: mediaClass, query, size, offset, sortOrder = 'desc', format = 'markdown', facets, embed = false, passages }: SearchMediaInput,
  ) => {
    try {
      if (embed && format !== 'markdown') {
        return toolError(`embed is only supported with format: "markdown" (got "${format}").`);
      }
      if (passages && (format !== 'markdown' || embed)) {
        return toolError('passages is only supported with format: "markdown", without embed.');
      }

      const requestedSize = size ?? requestedUnos(facets)?.length ?? DEFAULT_SEARCH_SIZE;
      const effectiveSize = embed ? Math.min(requestedSize, EMBED_MAX_DOCS) : requestedSize;
      const classFilter = mediaClass ? [mediaClass] : ['picture', 'video', 'graphic', 'videography'];
      const request: SearchQueryParams = {
        query,
        size: effectiveSize,
        sortOrder,
        startAt: offset,
        class: classFilter,
        provider: AFP_PROVIDERS,
        ...(facets ?? {}),
      };

      const apiFields = passages ? [...new Set([...MEDIA_API_FIELDS, ...PASSAGES_API_FIELDS])] : [...MEDIA_API_FIELDS];
      const { documents, count } = await apicore.search(request, apiFields, { parse: true, lenient: true });

      if (count === 0) {
        return { content: [textContent('No results found.')] };
      }

      if (passages) {
        const pagination = buildPaginationLine(documents.length, count, offset ?? 0);
        return { content: [textContent(`${pagination}\n\n${formatPassages(documents, passages)}`)] };
      }

      const docs = documents.map(normalizeMediaDocument);
      const currentOffset = offset ?? 0;

      if (embed) {
        const pagination = textContent(buildPaginationLine(docs.length, count, currentOffset));
        const embeddedContent = await embedMediaDocuments(docs);
        return {
          content: [pagination, ...embeddedContent],
          shown: docs.length,
          truncated: false,
          remaining: count - docs.length,
        };
      }

      return formatMediaOutput(docs, format, {
        jsonMeta: { total: count, offset: currentOffset },
        markdownPrefix: (shown) => [textContent(buildPaginationLine(shown, count, currentOffset))],
      });
    } catch (error) {
      return toolError(formatErrorMessage('searching AFP media', error, 'Check your query parameters and try again.'));
    }
  },
};
