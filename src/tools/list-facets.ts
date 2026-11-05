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
  preset: listPresetEnum.optional().describe('trending-topics: slug counts over the last 24h.'),
  facet: z.string().optional().describe("Facet to list: slug, genre, country, event, afpentity.person.keyword, afpentity.organisation.keyword… Required without preset."),
  lang: langEnum.optional().describe("Language filter"),
  query: z.string().optional().describe("Keywords restricting the counted articles."),
  dateFrom: z.string().optional().describe("Window start ('now-1d' or ISO date)."),
  dateTo: z.string().optional().describe("Window end (same syntax)."),
  size: z.number().optional().describe('Number of facet values to return'),
  format: outputFormatEnum.optional().describe('Output format: markdown (default), json, or csv.'),
  facets: z.record(z.string(), facetParamValueSchema).optional().describe(`Additional facet filters (country, genre, urgency, class…). ${REGION_FACET_NOTE}`),
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
  description: `List facet values with their article counts: discover topics (slug), genres, countries, events, people (afpentity.person.keyword) or organisations (afpentity.organisation.keyword) cited; get trending topics; compare activity across two time windows.

Defaults: class=text, provider=AFP (including its Arabic service); pass facets.class to count media too. Event values come with their readable label: the name is the id to filter on (afpevent:ID). Without lang, labels may be in another language than the answer: translate them.`,
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
