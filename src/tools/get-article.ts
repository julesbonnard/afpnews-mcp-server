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
  description: `Retrieve the full text and metadata of an AFP document by UNO (for a video: its shot list and soundbites).

${UNO_FORMAT_NOTE}

${PARAGRAPH_MARKER_NOTE}

Video shots carry their bounds in seconds as (t=start&end=end).`,
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
