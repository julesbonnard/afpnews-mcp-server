import type { AFPMediaDocument, MediaRenditions, MediaRendition, TextContent } from './types.js';
import { textContent, truncateToLimit } from './format.js';

// Mapping role AFP → clé normalisée (utilise m.role, pas m.rendition)
// Preview est prioritaire sur Preview_B/Preview_W (premier match gagne)
export const MEDIA_RENDITION_ROLE_MAP: Record<string, keyof MediaRenditions> = {
  'Thumbnail': 'thumbnail',
  'Preview':   'preview',
  'Preview_B': 'preview',
  'Preview_W': 'preview',
  'HighDef':   'highdef',
};

export function extractRenditions(bagItem: unknown): MediaRenditions {
  if (!Array.isArray(bagItem) || bagItem.length === 0) return {};
  const medias: any[] = (bagItem[0] as any)?.medias ?? [];
  const result: MediaRenditions = {};

  for (const m of medias) {
    const key = MEDIA_RENDITION_ROLE_MAP[m.role as string];
    if (!key) continue;
    if (result[key]) continue; // ne pas écraser (Preview prioritaire sur Preview_B/W)
    result[key] = {
      href: m.href,
      width: m.width,
      height: m.height,
      sizeInBytes: m.sizeInBytes,
      afpType: m.type,  // e.g. 'Photo', 'Graphic' — used for MIME type inference
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

  const displayRendition = preview ?? thumbnail;
  if (displayRendition) {
    lines.push(`![${caption}](${displayRendition.href})`);
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

export function formatMediaDocumentsAsJson(
  docs: AFPMediaDocument[],
  meta: Record<string, unknown> = {},
): { content: TextContent; truncated: boolean } {
  const { text, truncated } = truncateToLimit(
    docs,
    (slice) => JSON.stringify({
      ...meta,
      shown: slice.length,
      truncated: slice.length < docs.length,
      documents: slice,
    }, null, 2),
  );
  return { content: textContent(text), truncated };
}

export function formatMediaDocumentsAsCsv(docs: AFPMediaDocument[]): { content: TextContent; truncated: boolean } {
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

  const { text, truncated } = truncateToLimit(
    rows,
    (slice) => [header, ...slice].join('\n'),
  );
  return { content: textContent(text), truncated };
}
