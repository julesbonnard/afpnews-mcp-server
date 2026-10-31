import type { AfpDocument, AfpMediaRendition } from 'afpnews-api';
import type { AFPMediaDocument, MediaRenditions, MediaRendition, TextContent } from './types.js';
import { textContent, truncateToLimit, truncateContentItems, truncationHint, escapeCsvValue } from './format.js';

// Mapping role AFP → clé normalisée (utilise m.role, pas m.rendition)
// Preview est prioritaire sur Preview_B/Preview_W (premier match gagne)
export const MEDIA_RENDITION_ROLE_MAP: Record<string, keyof MediaRenditions> = {
  'Squared120': 'squared120',
  'Quicklook':  'quicklook',
  'Thumbnail':  'thumbnail',
  'Mockup':     'mockup',
  'Preview':    'preview',
  'Preview_B':  'preview',
  'Preview_W':  'preview',
  'HighDef':    'highdef',
};

export function extractRenditions(renditions: readonly AfpMediaRendition[] = []): MediaRenditions {
  const result: MediaRenditions = {};

  for (const m of renditions) {
    const key = MEDIA_RENDITION_ROLE_MAP[m.role];
    if (!key) continue;
    if (result[key]) continue; // ne pas écraser (Preview prioritaire sur Preview_B/W)
    result[key] = {
      href: m.href,
      width: m.width,
      height: m.height,
      sizeInBytes: m.sizeInBytes,
      afpType: m.type,
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

/** Adapte l'AfpDocument canonique du SDK à la sortie publique (json/csv/markdown) de ce tool. */
export function normalizeMediaDocument(doc: AfpDocument): AFPMediaDocument {
  return {
    uno: doc.uno,
    title: doc.title,
    caption: doc.caption,
    creditLine: doc.creditLine,
    creator: doc.creator,
    country: doc.country.name ?? doc.country.id,
    city: doc.city,
    published: doc.published.toISOString(),
    urgency: doc.urgency,
    class: doc.class,
    aspectRatios: doc.aspectRatios,
    advisory: doc.advisory,
    renditions: extractRenditions(doc.medias[0]?.renditions),
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
  const rows = docs.map((d) => [
    escapeCsvValue(d.uno),
    escapeCsvValue(d.title),
    escapeCsvValue(d.caption),
    escapeCsvValue(d.creditLine),
    escapeCsvValue(d.published),
    escapeCsvValue(d.class),
    escapeCsvValue(d.renditions.thumbnail?.href),
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
