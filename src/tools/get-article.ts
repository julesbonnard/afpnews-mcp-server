import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import { formatFullArticle, textContent, toolError } from '../utils/format.js';
import { formatErrorMessage, UNO_FORMAT_NOTE, PARAGRAPH_MARKER_NOTE } from './shared.js';

const inputSchema = z.object({
  uno: z.string().describe('The unique UNO identifier of the article'),
  format: z
    .enum(['markdown', 'json'])
    .optional()
    .describe('Output format: markdown (default, rendered article/shot list) or json (raw document, parse it yourself).'),
});

type GetArticleInput = z.infer<typeof inputSchema>;

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

${PARAGRAPH_MARKER_NOTE}

Args:
  - uno: The unique article identifier (e.g. newsml.afp.com.20260222T090659Z.doc-98hu39e)

Returns:
  Markdown-formatted article:
  - ## Headline
  - **UNO:** ...
  - **Lang:** · **Genre:** · **Class:** · **Revision:**
  - **Country:** · **City:** · **Slug:** · **Event:** (when available)
  - **Status:** · **Signal:** · **Advisory:** (when present)
  - ---
  - Full article body (### for subtitles, - for list items, all paragraphs, no truncation)

Example:
  { uno: "newsml.afp.com.20260222T090659Z.doc-98hu39e" }
  { uno: "newsml.afp.com.20260222T090659Z.doc-98hu39e", format: "json" }`,
  inputSchema,
  handler: async (apicore: Pick<ApiCore, 'get'>, { uno, format = 'markdown' }: GetArticleInput) => {
    try {
      if (format === 'json') {
        const raw = await apicore.get(uno);
        return { content: [textContent(JSON.stringify(raw, null, 2))] };
      }
      const doc = await apicore.get(uno, { parse: true });
      return { content: [formatFullArticle(doc)] };
    } catch (error) {
      return toolError(formatErrorMessage(`fetching article "${uno}"`, error, 'Verify the UNO identifier is correct.'));
    }
  },
};
