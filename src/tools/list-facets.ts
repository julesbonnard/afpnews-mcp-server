import { z } from 'zod';
import type { ApiCore, SearchQueryParams } from 'afpnews-api';
import { escapeCsvValue, textContent, toolError, truncateToLimit, truncationHint } from '../utils/format.js';
import {
  facetParamValueSchema,
  formatErrorMessage,
  langEnum,
  listPresetEnum,
  outputFormatEnum,
  REGION_FACET_NOTE,
  AFP_PROVIDERS,
} from './shared.js';

const inputSchema = z.object({
  preset: listPresetEnum.optional().describe('Optional preset for list queries. Available preset: trending-topics.'),
  facet: z.string().optional().describe("Facet to list (e.g. 'slug', 'genre', 'country', 'event', 'afpentity.person.keyword' for people cited, 'afpentity.organisation.keyword' for organisations cited). Required when no preset is used."),
  lang: langEnum.optional().describe("Language filter (e.g. 'en', 'fr')"),
  query: z.string().optional().describe("Keywords to scope the facet counts (e.g. 'climate change'). When set, counts reflect only articles matching the query."),
  dateFrom: z.string().optional().describe("Start of the time window (e.g. 'now-1d', '2026-01-01'). Combine with dateTo for a bounded window (e.g. to compare two periods)."),
  dateTo: z.string().optional().describe("End of the time window (e.g. 'now', 'now-1d', '2026-01-31')."),
  size: z.number().optional().describe('Number of facet values to return'),
  format: outputFormatEnum.optional().describe('Output format: markdown (default), json, or csv.'),
  facets: z.record(z.string(), facetParamValueSchema).optional().describe(`Additional facet filters passed to the AFP query (e.g. { country: ['usa'], genre: 'Papier général', urgency: 1 }). Counts cover AFP text articles by default: pass class (e.g. { class: ['text', 'picture', 'video'] }) to include media. ${REGION_FACET_NOTE}`),
});

type ListFacetsInput = z.infer<typeof inputSchema>;

type FacetResult = { name: string; label?: string; count: number };

// Les valeurs de `afpentity.event.keyword` sont « #ID : Nom » : une seule requête donne l'id et le nom.
// Un même id peut porter plusieurs libellés (renommage, langues) : ses comptes sont additionnés.
function eventResults(keywords: { name?: string | null; count: number }[]): FacetResult[] {
  const byId = new Map<string, FacetResult>();
  for (const { name, count } of keywords) {
    const match = /^#(\S+) : (.*)$/.exec(name ?? '');
    const id = match ? `afpevent:${match[1]}` : name ?? '';
    const existing = byId.get(id);
    if (existing) existing.count += count;
    else byId.set(id, { name: id, ...(match ? { label: match[2] } : {}), count });
  }
  return [...byId.values()].sort((a, b) => b.count - a.count);
}

function truncatedContent<T>(items: T[], serialize: (slice: T[]) => string) {
  const { text, truncated, remaining } = truncateToLimit(items, serialize);
  const content = [textContent(text)];
  if (truncated) content.push(textContent(truncationHint(remaining)));
  return { content };
}

export const afpListFacetsTool = {
  name: 'afp_list_facets',
  title: 'List AFP Facet Values',
  description: `List facet values and their article counts. Use this to discover available topics, genres, or countries, get trending topics, or compare activity across time windows.

Args:
  - preset: Optional preset (trending-topics) — overrides facet to 'slug' with last 24h news
  - facet: Facet to list (e.g. 'slug', 'genre', 'country', 'event'). Required when no preset is used.
           People and organisations cited in the articles: 'afpentity.person.keyword', 'afpentity.organisation.keyword'.
  - lang: Language filter (e.g. 'en', 'fr')
  - query: Keywords to scope the counts (e.g. 'climate change')
  - dateFrom / dateTo: Time window for the counts (e.g. dateFrom 'now-1d'; dateFrom '2026-01-01', dateTo '2026-01-31')
  - size: Number of facet values to return
  - format: Output format — markdown (default), json, or csv.
  - facets: Additional filters (country, region, genre, urgency, …). ${REGION_FACET_NOTE}
           Defaults: class=text, provider=AFP (afp and its Arabic service أ ف ب). Override class to count media too (e.g. { class: ["text", "picture", "video"] }).

Returns:
  - markdown: Formatted list with labels and article counts
  - json: Array of { name, count } objects
  - csv: name,count rows
  - facet "event": each value also has its readable name (label) — name is the id to filter on (afpevent:ID), no need to resolve it with another tool. Without lang, the label may be in another language than the answer: translate it

Examples:
  - Trending topics in French: { preset: "trending-topics" }
  - Trending topics in English: { preset: "trending-topics", lang: "en" }
  - Top slugs over the last 24h: { facet: "slug", dateFrom: "now-1d", format: "json" }
  - Top slugs over the previous 24h: { facet: "slug", dateFrom: "now-2d", dateTo: "now-1d", format: "json" }
  - Genres about a topic: { facet: "genre", query: "elections", format: "csv" }
  - List countries as JSON: { facet: "country", size: 30, format: "json" }
  - People in the news this week: { facet: "afpentity.person.keyword", dateFrom: "now-7d", format: "json" }`,
  inputSchema,
  handler: async (apicore: Pick<ApiCore, 'list'>, { preset, facet, lang, query, dateFrom, dateTo, size, format = 'markdown', facets }: ListFacetsInput) => {
    try {
      const isTrendingTopics = preset === 'trending-topics';
      const resolvedFacet = isTrendingTopics ? 'slug' : facet;

      if (!resolvedFacet) {
        return toolError("Missing required parameter: facet (e.g. 'slug', 'genre', 'country'). Alternatively, use preset: 'trending-topics'.");
      }

      const resolvedSize = size ?? 10;
      // Le preset trending impose slug + fenêtre 24h, mais dateFrom/dateTo/query
      // explicites restent prioritaires pour affiner ou comparer des périodes.
      const resolvedLang = lang ?? (isTrendingTopics ? 'fr' : undefined);
      const resolvedDateFrom = dateFrom ?? (isTrendingTopics ? 'now-1d' : undefined);
      const params: SearchQueryParams = {
        class: ['text'],
        provider: AFP_PROVIDERS,
        size: resolvedSize,
        ...(resolvedLang ? { langs: [resolvedLang] } : {}),
        ...(query ? { query } : {}),
        ...(resolvedDateFrom ? { dateFrom: resolvedDateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        ...(facets ?? {}),
      };

      const isEvent = resolvedFacet === 'event';
      // Chaque libellé (langue, renommage) est une ligne : en demander plus pour que le regroupement par id ne tronque pas les comptes
      const { keywords } = isEvent
        ? await apicore.list('afpentity.event.keyword', { ...params, size: resolvedSize * 5 }, 1)
        : await apicore.list(resolvedFacet, params, 1);
      const results: FacetResult[] = isEvent
        ? eventResults(keywords).slice(0, resolvedSize)
        : keywords.map(k => ({ name: k.name ?? '', count: k.count }));

      if (results.length === 0) {
        return { content: [textContent(`No facet values found for "${resolvedFacet}".`)] };
      }

      if (format === 'json') {
        return truncatedContent(results, (slice) => JSON.stringify(slice, null, 2));
      }

      if (format === 'csv') {
        const rows = results.map(r =>
          isEvent ? `${r.name},${escapeCsvValue(r.label ?? '')},${r.count}` : `${escapeCsvValue(r.name)},${r.count}`,
        );
        return truncatedContent(rows, (slice) => [isEvent ? 'name,label,count' : 'name,count', ...slice].join('\n'));
      }

      const heading = isTrendingTopics ? 'Trending Topics' : `Facet: ${resolvedFacet}`;
      return truncatedContent(
        results,
        (slice) => `## ${heading}\n\n${slice.map((item) => `- **${item.label ?? item.name}**${item.label ? ` (${item.name})` : ''} — ${item.count} articles`).join('\n')}`,
      );
    } catch (error) {
      return toolError(formatErrorMessage('listing facet values', error, "Check that the facet name is valid (e.g. 'slug', 'genre', 'country')."));
    }
  },
};
