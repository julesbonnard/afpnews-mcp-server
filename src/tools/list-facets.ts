import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import { textContent, toolError } from '../utils/format.js';
import {
  type FacetResult,
  formatErrorMessage,
  langEnum,
  listPresetEnum,
  outputFormatEnum,
} from './shared.js';

export const afpListFacetsTool = {
  name: 'afp_list_facets',
  title: 'List AFP Facet Values',
  description: `List facet values and their article counts. Use this to discover available topics, genres, or countries, or to get trending topics.

Args:
  - preset: Optional preset (trending-topics) — overrides facet to 'slug' with last 24h news
  - facet: Facet to list (e.g. 'slug', 'genre', 'country'). Required when no preset is used.
  - lang: Language filter (e.g. 'en', 'fr')
  - size: Number of facet values to return
  - format: Output format — markdown (default), json, or csv.

Returns:
  - markdown: Formatted list with labels and article counts
  - json: Array of { name, count } objects
  - csv: name,count rows

Examples:
  - Trending topics in French: { preset: "trending-topics" }
  - Trending topics in English: { preset: "trending-topics", lang: "en" }
  - List available genres as CSV: { facet: "genre", format: "csv" }
  - List countries as JSON: { facet: "country", size: 30, format: "json" }`,
  inputSchema: z.object({
    preset: listPresetEnum.optional().describe('Optional preset for list queries. Available preset: trending-topics.'),
    facet: z.string().optional().describe("Facet to list (e.g. 'slug', 'genre', 'country'). Required when no preset is used."),
    lang: langEnum.optional().describe("Language filter (e.g. 'en', 'fr')"),
    size: z.number().optional().describe('Number of facet values to return'),
    format: outputFormatEnum.optional().describe('Output format: markdown (default), json, or csv.'),
  }),
  handler: async (apicore: ApiCore, { preset, facet, lang, size, format = 'markdown' }: any) => {
    try {
      const isTrendingTopics = preset === 'trending-topics';
      const resolvedFacet = isTrendingTopics ? 'slug' : facet;

      if (!resolvedFacet) {
        return toolError("Missing required parameter: facet (e.g. 'slug', 'genre', 'country'). Alternatively, use preset: 'trending-topics'.");
      }

      const params: Record<string, unknown> = isTrendingTopics
        ? { langs: [lang ?? 'fr'], product: ['news'], dateFrom: 'now-1d', size: size ?? 10 }
        : (lang ? { langs: [lang], size: size ?? 10 } : { size: size ?? 10 });

      const rawResult = await apicore.list(resolvedFacet, params as any, 1) as any;
      const results: FacetResult[] = rawResult?.keywords ?? rawResult ?? [];

      if (results.length === 0) {
        return { content: [textContent(`No facet values found for "${resolvedFacet}".`)] };
      }

      if (format === 'json') {
        return { content: [textContent(JSON.stringify(results, null, 2))] };
      }

      if (format === 'csv') {
        const rows = results.map(r => {
          const name = /[",\n\r]/.test(r.name) ? `"${r.name.replaceAll('"', '""')}"` : r.name;
          return `${name},${r.count}`;
        });
        return { content: [textContent(['name,count', ...rows].join('\n'))] };
      }

      const heading = isTrendingTopics ? 'Trending Topics' : `Facet: ${resolvedFacet}`;
      const lines = results.map((item) => `- **${item.name}** — ${item.count} articles`);
      return { content: [textContent(`## ${heading}\n\n${lines.join('\n')}`)] };
    } catch (error) {
      return toolError(formatErrorMessage('listing facet values', error, "Check that the facet name is valid (e.g. 'slug', 'genre', 'country')."));
    }
  },
};
