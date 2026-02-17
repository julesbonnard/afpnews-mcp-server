import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import { formatDocument, toolError } from '../utils/format.js';
import { formatErrorMessage } from './shared.js';

export const afpGetArticleTool = {
  name: 'afp_get_article',
  title: 'Get AFP Article',
  description: `Get a full AFP news article by its UNO identifier. Use this after searching to retrieve the complete text of a specific article.

Args:
  - uno: The unique identifier (UNO) of the article (e.g. 'NEWS-FR-123456-ABC')

Returns:
  Markdown-formatted full article:
  - ## Headline
  - *UNO | Published date | Lang | Genre*
  - Complete article body

Examples:
  - Get a specific article: { uno: "NEWS-FR-123456-ABC" }`,
  inputSchema: z.object({
    uno: z.string().describe('The unique identifier (UNO) of the article'),
  }),
  handler: async (apicore: ApiCore, { uno }: any) => {
    try {
      const doc = await apicore.get(uno);
      return { content: [formatDocument(doc, true)] };
    } catch (error) {
      return toolError(formatErrorMessage(`fetching article "${uno}"`, error, 'Verify the UNO identifier is correct.'));
    }
  },
};
