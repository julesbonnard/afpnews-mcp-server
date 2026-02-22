import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import {
  formatDocumentsAsJson,
  formatDocumentsAsCsv,
  textContent,
  toolError,
  truncateIfNeeded,
} from '../utils/format.js';
import type { TextContent } from '../utils/types.js';
import {
  formatDocuments,
  formatErrorMessage,
  langEnum,
  outputFormatEnum,
  docFieldEnum,
  DEFAULT_OUTPUT_FIELDS,
  UNO_FORMAT_NOTE,
} from './shared.js';

export const afpFindSimilarTool = {
  name: 'afp_find_similar',
  title: 'Find Similar AFP Articles',
  description: `Find AFP news articles similar to a given article (More Like This). Useful for exploring related coverage or finding follow-up stories.

${UNO_FORMAT_NOTE}

Args:
  - uno: The UNO of the reference article to find similar content for
  - lang: Language for results (e.g. 'en', 'fr')
  - size: Number of similar articles to return (default 10)
  - format: Output format — markdown (default), json, or csv. json/csv omit article body text.
  - fields: Fields to include in json/csv output (default: uno, headline, lang, genre).
            Available: uno, headline, lang, genre, afpshortid, published, status, signal, advisory, country, city, slug, product, revision, created.

Returns:
  - markdown: Summary line + formatted article excerpts
  - json: { total, documents: [...] } with selected fields
  - csv: Header row + data rows with selected fields

Examples:
  - Find similar articles in French: { uno: "newsml.afp.com.20260222T090659Z.doc-98hu39e", lang: "fr" }
  - Export similar as CSV: { uno: "newsml.afp.com.20260222T090659Z.doc-98hu39e", lang: "en", format: "csv", fields: ["uno", "headline"] }`,
  inputSchema: z.object({
    uno: z.string().describe('The UNO of the reference article'),
    lang: langEnum.describe("Language for results (e.g. 'en', 'fr')"),
    size: z.number().optional().describe('Number of similar articles to return (default 10)'),
    format: outputFormatEnum.optional().describe('Output format: markdown (default, with article excerpt), json (structured, no body), csv (tabular, no body).'),
    fields: docFieldEnum.array().optional().describe('Fields to include in json/csv output. Default: afpshortid, uno, headline, published, lang, genre.'),
  }),
  handler: async (apicore: ApiCore, { uno, lang, size, format = 'markdown', fields }: any) => {
    try {
      const { documents, count } = await apicore.mlt(uno, lang, size);
      if (count === 0) {
        return { content: [textContent('No similar articles found.')] };
      }

      const outputFields: string[] = fields ?? DEFAULT_OUTPUT_FIELDS;

      if (format === 'json') {
        return { content: [formatDocumentsAsJson(documents, outputFields, { total: count })] };
      }

      if (format === 'csv') {
        return { content: [formatDocumentsAsCsv(documents, outputFields)] };
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
