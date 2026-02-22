import type { AFPDocument, TextContent } from './types.js';
import { EXCERPT_PARAGRAPH_COUNT, CHARACTER_LIMIT } from './types.js';

export const TRUNCATION_HINT = `\n\n---\n*Response truncated (exceeded ${CHARACTER_LIMIT} characters). Use a smaller \`size\` or add filters to reduce results.*`;

/** Fields requested from the API when rendering markdown output. */
export const MARKDOWN_API_FIELDS = ['uno', 'status', 'signal', 'advisory', 'headline', 'news', 'lang', 'genre'] as const;

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
): { text: string; count: number; truncated: boolean } {
  const full = serialize(items);
  if (full.length <= CHARACTER_LIMIT) {
    return { text: full, count: items.length, truncated: false };
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

  return { text: serialize(items.slice(0, lo)), count: lo, truncated: true };
}

function formatDocumentsAsJsonInner(
  docs: unknown[],
  fields: string[],
  meta: Record<string, unknown> = {},
): { content: TextContent; truncated: boolean } {
  const documents = docs.map(doc => pickDocFields(doc, fields));
  const { text, count, truncated } = truncateToLimit(
    documents,
    (slice) => JSON.stringify({ ...meta, shown: slice.length, truncated: slice.length < documents.length, documents: slice }, null, 2),
  );
  return { content: textContent(text), truncated };
}

function formatDocumentsAsCsvInner(
  docs: unknown[],
  fields: string[],
): { content: TextContent; truncated: boolean } {
  const rows = (docs as Record<string, unknown>[]).map(doc =>
    fields.map(f => escapeCsvValue(doc[f])).join(','),
  );
  const header = fields.join(',');
  const { text, truncated } = truncateToLimit(
    rows,
    (slice) => [header, ...slice].join('\n'),
  );
  return { content: textContent(text), truncated };
}

export function formatDocumentsAsJson(
  docs: unknown[],
  fields: string[],
  meta: Record<string, unknown> = {},
): TextContent {
  return formatDocumentsAsJsonInner(docs, fields, meta).content;
}

export function formatDocumentsAsCsv(docs: unknown[], fields: string[]): TextContent {
  return formatDocumentsAsCsvInner(docs, fields).content;
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
  lines.push(row(['Lang', d.lang], ['Genre', d.genre], ['Product', d.product], ['Revision', d.revision]));

  const extras = row(['Country', d.country], ['City', d.city], ['Slug', d.slug]);
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
    markdownPrefix?: TextContent[];
  },
): { content: TextContent[] } {
  if (format === 'json') {
    const { content, truncated } = formatDocumentsAsJsonInner(documents, opts.fields, opts.jsonMeta);
    const result: TextContent[] = [content];
    if (truncated) result.push(textContent(TRUNCATION_HINT));
    return { content: result };
  }
  if (format === 'csv') {
    const { content, truncated } = formatDocumentsAsCsvInner(documents, opts.fields);
    const result: TextContent[] = [content];
    if (truncated) result.push(textContent(TRUNCATION_HINT));
    return { content: result };
  }
  const content: TextContent[] = [
    ...(opts.markdownPrefix ?? []),
    ...documents.map(doc => formatDocument(doc, opts.fullText ?? false)),
  ];
  return { content: truncateIfNeeded(content) };
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

export function truncateIfNeeded(content: TextContent[]): TextContent[] {
  const totalLength = content.reduce((sum, c) => sum + c.text.length, 0);
  if (totalLength <= CHARACTER_LIMIT) return content;

  let accumulated = 0;
  const truncated: TextContent[] = [];
  for (const item of content) {
    if (accumulated + item.text.length > CHARACTER_LIMIT) {
      const remaining = CHARACTER_LIMIT - accumulated;
      if (remaining > 100) {
        truncated.push(textContent(item.text.slice(0, remaining) + '\n\n[...truncated]'));
      }
      break;
    }
    truncated.push(item);
    accumulated += item.text.length;
  }
  truncated.push(textContent(TRUNCATION_HINT));
  return truncated;
}

export function buildPaginationLine(shown: number, total: number, offset: number): string {
  const hasMore = total > offset + shown;
  return `*Showing ${shown} of ${total} results (offset: ${offset}).${hasMore ? ` Use offset=${offset + shown} to see more.` : ''}*`;
}
