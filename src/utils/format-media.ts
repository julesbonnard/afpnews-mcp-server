import type { AFPMediaDocument, MediaRenditions, MediaRendition, TextContent } from './types.js';
import { textContent, truncateToLimit, truncateContentItems, truncationHint } from './format.js';

// Mapping role AFP → clé normalisée (utilise m.role, pas m.rendition)
// Preview est prioritaire sur Preview_B/Preview_W (premier match gagne)
export const MEDIA_RENDITION_ROLE_MAP: Record<string, keyof MediaRenditions> = {
  'Quicklook': 'quicklook',
  'Thumbnail': 'thumbnail',
  'Preview':   'preview',
  'Preview_B': 'preview',
  'Preview_W': 'preview',
  'HighDef':   'highdef',
};

export function extractRenditions(bagItem: unknown): MediaRenditions {
  if (!Array.isArray(bagItem) || bagItem.length === 0) return {};
  const first = bagItem[0] as Record<string, unknown> | undefined;
  const medias = (Array.isArray(first?.medias) ? first.medias : []) as Record<string, unknown>[];
  const result: MediaRenditions = {};

  for (const m of medias) {
    const key = MEDIA_RENDITION_ROLE_MAP[m.role as string];
    if (!key) continue;
    if (result[key]) continue; // ne pas écraser (Preview prioritaire sur Preview_B/W)
    result[key] = {
      href: m.href as string,
      width: m.width as number,
      height: m.height as number,
      sizeInBytes: m.sizeInBytes as number | undefined,
      afpType: m.type as string | undefined,
    } satisfies MediaRendition;
  }

  return result;
}

export function formatMediaDocument(doc: Partial<AFPMediaDocument> & { uno: string; renditions: MediaRenditions }): TextContent {
  const meta: string[] = [
    `UNO: ${doc.uno}`,
    ...(doc.class ? [`Class: ${doc.class}`] : []),
    ...(doc.creditLine ? [doc.creditLine] : []),
    ...((doc.city || doc.country) ? [`${[doc.city, doc.country].filter(Boolean).join(', ')}`] : []),
    ...(doc.published ? [doc.published.slice(0, 10)] : []),
  ];

  const lines: string[] = [];
  if (doc.title) lines.push(`## ${doc.title}`);
  lines.push(`*${meta.join(' | ')}*`);
  lines.push('');

  const { thumbnail, preview, highdef } = doc.renditions;
  const caption = doc.caption ?? '';

  if (thumbnail) {
    lines.push(`![${caption}](${thumbnail.href})`);
    lines.push('');
  }

  if (preview) {
    lines.push(`[Preview ${preview.width}px](${preview.href})`);
    lines.push('');
  }

  if (highdef) {
    lines.push(`[HighDef ${highdef.width}px](${highdef.href})`);
    lines.push('');
  }

  if (doc.advisory) {
    lines.push(`> ${doc.advisory}`);
  }

  return textContent(lines.join('\n').trimEnd());
}

export function normalizeMediaDocument(raw: unknown): AFPMediaDocument {
  const d = raw as Record<string, unknown>;
  return {
    uno: d.uno as string,
    title: d.title as string | undefined,
    caption: Array.isArray(d.caption) ? d.caption[0] as string : d.caption as string | undefined,
    creditLine: d.creditLine as string | undefined,
    creator: d.creator as string | undefined,
    country: d.country as string | undefined,
    city: d.city as string | undefined,
    published: d.published as string | undefined,
    urgency: d.urgency as number | undefined,
    class: d.class as string | undefined,
    aspectRatios: d.aspectRatios as string[] | undefined,
    advisory: d.advisory as string | undefined,
    renditions: extractRenditions(d.bagItem ?? []),
  };
}

export function formatMediaDocumentsAsJson(
  docs: AFPMediaDocument[],
  meta: Record<string, unknown> = {},
): { content: TextContent; shown: number; truncated: boolean; remaining: number } {
  const { text, count, truncated, remaining } = truncateToLimit(
    docs,
    (slice) => JSON.stringify({
      ...meta,
      shown: slice.length,
      truncated: slice.length < docs.length,
      remaining: docs.length - slice.length,
      documents: slice,
    }, null, 2),
  );
  return { content: textContent(text), shown: count, truncated, remaining };
}

export function formatMediaDocumentsAsCsv(docs: AFPMediaDocument[]): { content: TextContent; shown: number; truncated: boolean; remaining: number } {
  const header = 'uno,title,caption,creditLine,published,class,thumbnail_href';
  const escape = (v: unknown) => {
    const str = String(v ?? '');
    if (/[",\n\r]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
    return str;
  };
  const rows = docs.map((d) => [
    escape(d.uno),
    escape(d.title),
    escape(d.caption),
    escape(d.creditLine),
    escape(d.published),
    escape(d.class),
    escape(d.renditions.thumbnail?.href),
  ].join(','));

  const { text, count, truncated, remaining } = truncateToLimit(
    rows,
    (slice) => [header, ...slice].join('\n'),
  );
  return { content: textContent(text), shown: count, truncated, remaining };
}

export function formatMediaOutput(
  docs: AFPMediaDocument[],
  format: string,
  opts: {
    jsonMeta?: Record<string, unknown>;
    markdownPrefix?: TextContent[] | ((shown: number) => TextContent[]);
  } = {},
): { content: TextContent[]; shown: number; truncated: boolean; remaining: number } {
  if (format === 'json') {
    const { content, shown, truncated, remaining } = formatMediaDocumentsAsJson(docs, opts.jsonMeta);
    return { content: [content], shown, truncated, remaining };
  }

  if (format === 'csv') {
    const { content, shown, truncated, remaining } = formatMediaDocumentsAsCsv(docs);
    const result: TextContent[] = [content];
    if (truncated) result.push(textContent(truncationHint(remaining)));
    return { content: result, shown, truncated, remaining };
  }

  return truncateContentItems(
    opts.markdownPrefix ?? [],
    docs.map(formatMediaDocument),
  );
}
