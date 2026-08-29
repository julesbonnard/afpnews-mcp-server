import { MANDATORY_RAW_FIELDS, parseParagraphBlocks } from 'afpnews-api';
import type { AfpDocument, AfpParagraph } from 'afpnews-api';
import type { DocField, TextContent } from './types.js';
import { EXCERPT_PARAGRAPH_COUNT, CHARACTER_LIMIT } from './config.js';

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
  wordCount: d => d.wordCount,
};

// Champs publics dont le nom de requête API brut diffère du DocField (ou nécessite plusieurs
// champs bruts) — le reste se demande sous le même nom que le DocField.
const RAW_FIELD_OVERRIDES: Partial<Record<DocField, readonly string[]>> = {
  event: ['afpentity'],
  country: ['country', 'countryname'],
};

/**
 * Traduit une liste de DocField publics en noms de champs à demander à l'API AFP. Le socle
 * (MANDATORY_RAW_FIELDS) est aussi injecté automatiquement par le SDK dès que { parse: true }
 * est utilisé — l'inclure ici en plus garde toApiFields() correct même pour un appel sans parse.
 */
export function toApiFields(fields: readonly DocField[]): string[] {
  const raw = fields.flatMap(f => RAW_FIELD_OVERRIDES[f] ?? [f]);
  return [...new Set([...MANDATORY_RAW_FIELDS, ...raw])];
}

/**
 * Renders paragraphs as structured Markdown (### for subtitles, - for list
 * items) with a `[¶n]` marker per paragraph — the same numbering convention
 * afpnews-deck uses for its `?p=n` deep links, so a model reading this text
 * can build a correct link back to a specific paragraph. A list block's `j`-th
 * item is always raw paragraph `block.startIndex + j`, since grouping only
 * merges strictly consecutive dash lines.
 */
function renderParagraphsMarkdown(paragraphs: AfpParagraph[]): string {
  const blocks = parseParagraphBlocks(paragraphs.map(p => p.text));
  return blocks
    .map((block) => {
      if (block.type === 'subtitle') return `### [¶${block.startIndex + 1}] ${block.text}`;
      if (block.type === 'list') {
        return block.items
          .map((item, j) => `- [¶${block.startIndex + j + 1}] ${item}`)
          .join('\n');
      }
      return `[¶${block.startIndex + 1}] ${block.text}`;
    })
    .join('\n\n');
}

/** Render a video shot list (timecodes + descriptions + soundbite quotes) from `AfpDocument.shots`. */
function renderShots(shots: NonNullable<AfpDocument['shots']>): string {
  const lines = shots.map((shot) => {
    const head = `${shot.numero}. [${shot.start}-${shot.end}] ${shot.description}`.trimEnd();
    const quotes = shot.citations.map((c) => `   "${c.text}"`);
    return [head, ...quotes].join('\n');
  });

  return `## Shot list\n\n${lines.join('\n')}`;
}

export function truncationHint(remaining?: number): string {
  const suffix = remaining != null && remaining > 0
    ? ` ${remaining} additional item(s) not returned.`
    : '';
  return `\n\n---\n*Response truncated.${suffix} Use a smaller \`size\`, add filters, or use \`offset\` to paginate.*`;
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
  docs: AfpDocument[],
  fields: DocField[],
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
  docs: AfpDocument[],
  fields: DocField[],
): { content: TextContent; shown: number; truncated: boolean; remaining: number } {
  const rows = docs.map(doc =>
    fields.map(f => escapeCsvValue(FIELD_ACCESSORS[f](doc))).join(','),
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

export function formatDocument(doc: AfpDocument, fullText = false): TextContent {
  const meta: string[] = [`UNO: ${doc.uno}`];
  if (doc.lang) meta.push(`Lang: ${doc.lang}`);
  if (doc.genre) meta.push(`Genre: ${doc.genre}`);
  if (doc.status) meta.push(`Status: ${doc.status}`);
  if (doc.signal) meta.push(`Signal: ${doc.signal}`);
  if (doc.advisory) meta.push(`Advisory: ${doc.advisory}`);
  if (doc.events.length) meta.push(`Event: ${doc.events.map(e => e.name).join(', ')}`);

  const body = renderParagraphsMarkdown(
    fullText ? doc.paragraphs : doc.paragraphs.slice(0, EXCERPT_PARAGRAPH_COUNT),
  );

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
  const body = doc.shots?.length ? renderShots(doc.shots) : renderParagraphsMarkdown(doc.paragraphs);

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
