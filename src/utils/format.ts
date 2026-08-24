import { parseDocument } from 'afpnews-api';
import type { AfpDocument } from 'afpnews-api';
import type { DocField, TextContent } from './types.js';
import { EXCERPT_PARAGRAPH_COUNT, CHARACTER_LIMIT } from './types.js';

export const TRUNCATION_HINT = `\n\n---\n*Response truncated (exceeded ${CHARACTER_LIMIT} characters). Use a smaller \`size\` or add filters to reduce results.*`;

/**
 * One accessor per public `DocField`, reading from the canonical `AfpDocument`. This is the
 * single bridge between the SDK model and the tool's public field vocabulary (json/csv/markdown) —
 * `Record<DocField, ...>` forces a compile error if a new DocField is added without an accessor.
 */
const FIELD_ACCESSORS: Record<DocField, (doc: AfpDocument) => unknown> = {
  afpshortid: d => d.shortId,
  uno: d => d.uno,
  headline: d => d.headline,
  published: d => d.published.toISOString(),
  lang: d => d.lang,
  genre: d => d.genre,
  status: d => d.status,
  signal: d => d.signal,
  advisory: d => d.advisory,
  country: d => d.country.name ?? d.country.id,
  city: d => d.city,
  slug: d => d.slugs,
  event: d => d.events.map(e => e.name),
  'class': d => d.class,
  revision: d => d.revision,
  created: d => d.created.toISOString(),
};

// Champs bruts AFP à demander à l'API pour que parseDocument() réussisse, quel que soit le
// format/les fields demandés (DocumentSourceSchema du SDK les exige tous).
const MANDATORY_API_FIELDS = ['uno', 'class', 'urgency', 'created', 'published', 'revision', 'provider', 'status', 'lang'] as const;

// Champs publics dont le nom de requête API brut diffère du DocField (ou nécessite plusieurs
// champs bruts) — le reste se demande sous le même nom que le DocField.
const RAW_FIELD_OVERRIDES: Partial<Record<DocField, readonly string[]>> = {
  event: ['afpentity'],
  country: ['country', 'countryname'],
};

/** Traduit une liste de DocField publics en noms de champs à demander à l'API AFP. */
export function toApiFields(fields: readonly DocField[]): string[] {
  const raw = fields.flatMap(f => RAW_FIELD_OVERRIDES[f] ?? [f]);
  return [...new Set([...MANDATORY_API_FIELDS, ...raw])];
}

/** Fields requested from the API when rendering markdown output. */
export const MARKDOWN_API_FIELDS = [...toApiFields(['genre', 'status', 'signal', 'advisory', 'event']), 'headline', 'news'];

export function escapeCsvValue(value: unknown): string {
  const str = Array.isArray(value) ? value.join('|') : String(value ?? '');
  if (/[",\n\r]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
  return str;
}

export function pickDocFields(doc: AfpDocument, fields: DocField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(f => [f, FIELD_ACCESSORS[f](doc) ?? null]));
}

/** Parse un document brut, ou undefined s'il ne correspond pas au modèle canonique (jamais lève). */
export function tryParseDocument(raw: unknown): AfpDocument | undefined {
  try {
    return parseDocument(raw);
  } catch {
    return undefined;
  }
}

/** Parse une liste de documents bruts, en ignorant silencieusement ceux qui échouent. */
export function parseDocuments(docs: unknown[]): AfpDocument[] {
  return docs.flatMap(d => {
    const parsed = tryParseDocument(d);
    return parsed ? [parsed] : [];
  });
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
  docs: AfpDocument[],
  fields: DocField[],
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
  docs: AfpDocument[],
  fields: DocField[],
): { content: TextContent; truncated: boolean } {
  const rows = docs.map(doc =>
    fields.map(f => escapeCsvValue(FIELD_ACCESSORS[f](doc))).join(','),
  );
  const header = fields.join(',');
  const { text, truncated } = truncateToLimit(
    rows,
    (slice) => [header, ...slice].join('\n'),
  );
  return { content: textContent(text), truncated };
}

export function formatDocumentsAsJson(
  docs: AfpDocument[],
  fields: DocField[],
  meta: Record<string, unknown> = {},
): TextContent {
  return formatDocumentsAsJsonInner(docs, fields, meta).content;
}

export function formatDocumentsAsCsv(docs: AfpDocument[], fields: DocField[]): TextContent {
  return formatDocumentsAsCsvInner(docs, fields).content;
}

export function formatDocument(doc: AfpDocument, fullText = false): TextContent {
  const meta: string[] = [
    `UNO: ${doc.uno}`,
    `Lang: ${doc.lang}`,
    `Genre: ${doc.genre}`,
  ];
  if (doc.status) meta.push(`Status: ${doc.status}`);
  if (doc.signal) meta.push(`Signal: ${doc.signal}`);
  if (doc.advisory) meta.push(`Advisory: ${doc.advisory}`);
  if (doc.events.length) meta.push(`Event: ${doc.events.map(e => e.name).join(', ')}`);

  const paragraphs = doc.paragraphs.map(p => p.text);
  const body = fullText
    ? paragraphs.join('\n\n')
    : paragraphs.slice(0, EXCERPT_PARAGRAPH_COUNT).join('\n\n');

  return textContent(`## ${doc.headline}\n*${meta.join(' | ')}*\n\n${body}`);
}

export function formatFullArticle(doc: AfpDocument): TextContent {
  const row = (...pairs: Array<[string, unknown]>) =>
    pairs
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `**${k}:** ${Array.isArray(v) ? v.join(', ') : v}`)
      .join(' · ');

  const lines: string[] = [];
  lines.push(row(['UNO', doc.uno]));
  lines.push(row(['Lang', doc.lang], ['Genre', doc.genre], ['Class', doc.class], ['Revision', doc.revision]));

  const extras = row(
    ['Country', doc.country.name ?? doc.country.id],
    ['City', doc.city],
    ['Slug', doc.slugs],
    ['Event', doc.events.map(e => e.name)],
  );
  if (extras) lines.push(extras);

  const flags = row(['Status', doc.status], ['Signal', doc.signal], ['Advisory', doc.advisory]);
  if (flags) lines.push(flags);

  const meta = lines.join('\n');
  const body = doc.paragraphs.map(p => p.text).join('\n\n');

  return textContent(`## ${doc.headline}\n\n${meta}\n\n---\n\n${body}`);
}

/**
 * Unified output formatter for multi-document tool results.
 * Handles json/csv/markdown branching in one place.
 */
export function formatDocumentOutput(
  documents: AfpDocument[],
  format: string,
  opts: {
    fields: DocField[];
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
