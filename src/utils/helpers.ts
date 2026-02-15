import type { ApiCore } from 'afpnews-api';
import type { FormattedContent } from './types.js';
import { formatDocument, DEFAULT_FIELDS } from './format.js';

export async function searchAndFormat(
  apicore: ApiCore,
  params: any,
  fullText = false,
  fields: readonly string[] = DEFAULT_FIELDS
): Promise<FormattedContent[]> {
  const { documents } = await apicore.search(params, fields as string[]);
  return documents.map((doc: unknown) => formatDocument(doc, fullText));
}
