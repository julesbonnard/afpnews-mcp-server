import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import { textContent, toolError } from '../utils/format.js';
import { getTopicLabel } from '../utils/topics.js';
import { DEFAULT_FACET_SIZE } from '../utils/types.js';
import {
  type FacetResult,
  formatErrorMessage,
  langEnum,
  listPresetEnum,
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

Returns:
  Markdown-formatted list of facet values with article counts:
  - **Label or key** — N articles

Examples:
  - Trending topics in French: { preset: "trending-topics" }
  - Trending topics in English: { preset: "trending-topics", lang: "en" }
  - List available genres: { facet: "genre" }
  - List countries: { facet: "country", size: 30 }`,
  inputSchema: z.object({
    preset: listPresetEnum.optional().describe('Optional preset for list queries. Available preset: trending-topics.'),
    facet: z.string().optional().describe("Facet to list (e.g. 'slug', 'genre', 'country'). Required when no preset is used."),
    lang: langEnum.optional().describe("Language filter (e.g. 'en', 'fr')"),
    size: z.number().optional().describe('Number of facet values to return'),
  }),
  handler: async (apicore: ApiCore, { preset, facet, lang, size }: any) => {
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
  },
};
