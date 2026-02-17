import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import { textContent, toolError, truncateIfNeeded } from '../utils/format.js';
import type { TextContent } from '../utils/types.js';
import {
  formatDocuments,
  formatErrorMessage,
  langEnum,
} from './shared.js';

export const afpFindSimilarTool = {
  name: 'afp_find_similar',
  title: 'Find Similar AFP Articles',
  description: `Find AFP news articles similar to a given article (More Like This). Useful for exploring related coverage or finding follow-up stories.

Args:
  - uno: The UNO of the reference article to find similar content for
  - lang: Language for results (e.g. 'en', 'fr')
  - size: Number of similar articles to return (default 10)

Returns:
  Pagination summary, followed by markdown-formatted article excerpts:
  - ## Headline
  - *UNO | Published date | Lang | Genre*
  - Article excerpt (first paragraphs)

Examples:
  - Find similar articles in French: { uno: "NEWS-FR-123456-ABC", lang: "fr" }
  - Get 5 similar English articles: { uno: "NEWS-EN-789", lang: "en", size: 5 }`,
  inputSchema: z.object({
    uno: z.string().describe('The UNO of the reference article'),
    lang: langEnum.describe("Language for results (e.g. 'en', 'fr')"),
    size: z.number().optional().describe('Number of similar articles to return (default 10)'),
  }),
  handler: async (apicore: ApiCore, { uno, lang, size }: any) => {
    try {
      const { documents, count } = await apicore.mlt(uno, lang, size);
      if (count === 0) {
        return { content: [textContent('No similar articles found.')] };
      }

      const content: TextContent[] = [
        textContent(`*Found ${count} similar articles.*`),
        ...formatDocuments(documents, false),
      ];
      return { content: truncateIfNeeded(content) };
    } catch (error) {
      return toolError(formatErrorMessage(`finding similar articles for "${uno}"`, error, 'Verify the UNO identifier is correct.'));
    }
  },
};
