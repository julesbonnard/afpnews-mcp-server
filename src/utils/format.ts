import type { AFPDocument, TextContent } from './types.js';
import { EXCERPT_PARAGRAPH_COUNT, CHARACTER_LIMIT } from './types.js';

export function truncationHint(remaining?: number): string {
  const suffix = remaining != null && remaining > 0
    ? ` ${remaining} additional item(s) not returned.`
    : '';
  return `\n\n---\n*Response truncated.${suffix} Use a smaller \`size\`, add filters, or use \`offset\` to paginate.*`;
}

/** Fields requested from the API when rendering markdown output. */
export const MARKDOWN_API_FIELDS = ['uno', 'status', 'signal', 'advisory', 'headline', 'news', 'lang', 'genre', 'event'] as const;

export function escapeCsvValue(value: unknown): string {
  const str = Array.isArray(value) ? value.join('|') : String(value ?? '');
  if (/[",\n\r]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
  return str;
}

export function pickDocFields(doc: unknown, fields: string[]): Record<string, unknown> {
  const d = doc as Record<string, unknown>;
  return Object.fromEntries(fields.map(f => [f, d[f] ?? null]));
}

/**
 * Truncate an array of items so the serialized output fits within CHARACTER_LIMIT.
 * Uses binary search O(log n) when truncation is needed.
 */
export function truncateToLimit<T>(
  items: T[],
  serialize: (slice: T[]) => string,
): { text: string; count: number; truncated: boolean; remaining: number } {
  const full = serialize(items);
  if (full.length <= CHARACTER_LIMIT) {
    return { text: full, count: items.length, truncated: false, remaining: 0 };
  }

  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (serialize(items.slice(0, mid)).length <= CHARACTER_LIMIT) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return { text: serialize(items.slice(0, lo)), count: lo, truncated: true, remaining: items.length - lo };
}

function formatDocumentsAsJsonInner(
  docs: unknown[],
  fields: string[],
  meta: Record<string, unknown> = {},
): { content: TextContent; shown: number; truncated: boolean; remaining: number } {
  const documents = docs.map(doc => pickDocFields(doc, fields));
  const { text, count, truncated, remaining } = truncateToLimit(
    documents,
    (slice) => JSON.stringify({ ...meta, shown: slice.length, truncated: slice.length < documents.length, remaining: documents.length - slice.length, documents: slice }, null, 2),
  );
  return { content: textContent(text), shown: count, truncated, remaining };
}

function formatDocumentsAsCsvInner(
  docs: unknown[],
  fields: string[],
): { content: TextContent; shown: number; truncated: boolean; remaining: number } {
  const rows = (docs as Record<string, unknown>[]).map(doc =>
    fields.map(f => escapeCsvValue(doc[f])).join(','),
  );
  const header = fields.join(',');
  const { text, count, truncated, remaining } = truncateToLimit(
    rows,
    (slice) => [header, ...slice].join('\n'),
  );
  return { content: textContent(text), shown: count, truncated, remaining };
}

export function truncateContentItems(
  prefix: TextContent[] | ((shown: number) => TextContent[]),
  items: TextContent[],
): { content: TextContent[]; shown: number; truncated: boolean; remaining: number } {
  if (typeof prefix === 'function') {
    let estimatedShown = items.length;

    for (let i = 0; i < 3; i += 1) {
      const result = truncateContentItemsWithPrefix(prefix(estimatedShown), items);
      if (result.shown === estimatedShown || !result.truncated) {
        return result;
      }
      estimatedShown = result.shown;
    }

    return truncateContentItemsWithPrefix(prefix(estimatedShown), items);
  }

  return truncateContentItemsWithPrefix(prefix, items);
}

function truncateContentItemsWithPrefix(
  prefix: TextContent[],
  items: TextContent[],
): { content: TextContent[]; shown: number; truncated: boolean; remaining: number } {
  const prefixLength = prefix.reduce((sum, item) => sum + item.text.length, 0);
  let accumulated = prefixLength;
  const result: TextContent[] = [...prefix];
  let shown = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (accumulated + item.text.length <= CHARACTER_LIMIT) {
      result.push(item);
      accumulated += item.text.length;
      shown += 1;
      continue;
    }

    const remaining = items.length - shown;
    result.push(textContent(truncationHint(remaining)));
    return { content: result, shown, truncated: true, remaining };
  }

  return { content: result, shown, truncated: false, remaining: 0 };
}

export function formatDocument(doc: unknown, fullText = false): TextContent {
  const d = doc as AFPDocument;

  const meta: string[] = [
    `UNO: ${d.uno}`,
    `Lang: ${d.lang}`,
    `Genre: ${d.genre}`,
  ];
  if (d.status) meta.push(`Status: ${d.status}`);
  if (d.signal) meta.push(`Signal: ${d.signal}`);
  if (d.advisory) meta.push(`Advisory: ${d.advisory}`);
  if (d.event?.length) meta.push(`Event: ${d.event.join(', ')}`);

  const paragraphs = Array.isArray(d.news) ? d.news : [];
  const body = fullText
    ? paragraphs.join('\n\n')
    : paragraphs.slice(0, EXCERPT_PARAGRAPH_COUNT).join('\n\n');

  return textContent(`## ${d.headline}\n*${meta.join(' | ')}*\n\n${body}`);
}

export function formatFullArticle(doc: unknown): TextContent {
  const d = doc as AFPDocument;

  const row = (...pairs: Array<[string, unknown]>) =>
    pairs
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `**${k}:** ${Array.isArray(v) ? v.join(', ') : v}`)
      .join(' · ');

  const lines: string[] = [];
  lines.push(row(['UNO', d.uno]));
  lines.push(row(['Lang', d.lang], ['Genre', d.genre], ['Class', d['class']], ['Revision', d.revision]));

  const extras = row(['Country', d.country], ['City', d.city], ['Slug', d.slug], ['Event', d.event]);
  if (extras) lines.push(extras);

  const flags = row(['Status', d.status], ['Signal', d.signal], ['Advisory', d.advisory]);
  if (flags) lines.push(flags);

  const meta = lines.join('\n');
  const body = (Array.isArray(d.news) ? d.news : []).join('\n\n');

  return textContent(`## ${d.headline}\n\n${meta}\n\n---\n\n${body}`);
}

/**
 * Unified output formatter for multi-document tool results.
 * Handles json/csv/markdown branching in one place.
 */
export function formatDocumentOutput(
  documents: unknown[],
  format: string,
  opts: {
    fields: string[];
    fullText?: boolean;
    jsonMeta?: Record<string, unknown>;
    markdownPrefix?: TextContent[] | ((shown: number) => TextContent[]);
  },
): { content: TextContent[]; shown: number; truncated: boolean; remaining: number } {
  if (format === 'json') {
    const { content, shown, truncated, remaining } = formatDocumentsAsJsonInner(documents, opts.fields, opts.jsonMeta);
    return { content: [content], shown, truncated, remaining };
  }
  if (format === 'csv') {
    const { content, shown, truncated, remaining } = formatDocumentsAsCsvInner(documents, opts.fields);
    const result: TextContent[] = [content];
    if (truncated) result.push(textContent(truncationHint(remaining)));
    return { content: result, shown, truncated, remaining };
  }
  return truncateContentItems(
    opts.markdownPrefix ?? [],
    documents.map(doc => formatDocument(doc, opts.fullText ?? false)),
  );
}

export function textContent(text: string): TextContent {
  return { type: 'text', text };
}

export function toolError(message: string) {
  return {
    isError: true as const,
    content: [textContent(message)],
  };
}

export function buildPaginationLine(shown: number, total: number, offset: number): string {
  const hasMore = total > offset + shown;
  return `*Showing ${shown} of ${total} results (offset: ${offset}).${hasMore ? ` Use \`offset: ${offset + shown}\` to see more.` : ''}*`;
}
