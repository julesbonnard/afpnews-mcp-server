import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import { formatFullArticle, toolError } from '../utils/format.js';
import { formatErrorMessage, UNO_FORMAT_NOTE } from './shared.js';

export const afpGetArticleTool = {
  name: 'afp_get_article',
  title: 'Get AFP Article',
  description: `Retrieve the complete text of a specific AFP article by its UNO identifier.

Use this tool when you have a UNO (from afp_search_articles or afp_find_similar results) and need:
  - The full, untruncated article body
  - All available metadata (country, city, slug, revision, status, signal, advisory)
  - A definitive version of the article before quoting or summarising

Do NOT use this to discover articles — use afp_search_articles for that.

${UNO_FORMAT_NOTE}

Args:
  - uno: The unique article identifier (e.g. newsml.afp.com.20260222T090659Z.doc-98hu39e)

Returns:
  Markdown-formatted article:
  - ## Headline
  - **UNO:** ...
  - **Lang:** · **Genre:** · **Product:** · **Revision:**
  - **Country:** · **City:** · **Slug:** (when available)
  - **Status:** · **Signal:** · **Advisory:** (when present)
  - ---
  - Full article body (all paragraphs, no truncation)

Example:
  { uno: "newsml.afp.com.20260222T090659Z.doc-98hu39e" }`,
  inputSchema: z.object({
    uno: z.string().describe('The unique UNO identifier of the article'),
  }),
  handler: async (apicore: ApiCore, { uno }: any) => {
    try {
      const doc = await apicore.get(uno);
      return { content: [formatFullArticle(doc)] };
    } catch (error) {
      return toolError(formatErrorMessage(`fetching article "${uno}"`, error, 'Verify the UNO identifier is correct.'));
    }
  },
};
