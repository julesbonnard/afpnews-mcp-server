import type { AFPDocument, TextContent } from './types.js';
import { EXCERPT_PARAGRAPH_COUNT, CHARACTER_LIMIT } from './types.js';

function escapeCsvValue(value: unknown): string {
  const str = Array.isArray(value) ? value.join('|') : String(value ?? '');
  if (/[",\n\r]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
  return str;
}

export function pickDocFields(doc: unknown, fields: string[]): Record<string, unknown> {
  const d = doc as Record<string, unknown>;
  return Object.fromEntries(fields.map(f => [f, d[f] ?? null]));
}

export function formatDocumentsAsJson(
  docs: unknown[],
  fields: string[],
  meta: Record<string, unknown> = {},
): TextContent {
  const documents = docs.map(doc => pickDocFields(doc, fields));
  return textContent(JSON.stringify({ ...meta, documents }, null, 2));
}

export function formatDocumentsAsCsv(docs: unknown[], fields: string[]): TextContent {
  const rows = (docs as Record<string, unknown>[]).map(doc =>
    fields.map(f => escapeCsvValue(doc[f])).join(','),
  );
  return textContent([fields.join(','), ...rows].join('\n'));
}

export const GENRE_EXCLUSIONS = {
  exclude: [
    'afpgenre:Agenda',
    'afpattribute:Agenda',
    'afpattribute:Program',
    'afpattribute:TextProgram',
    'afpattribute:AdvisoryUpdate',
    'afpattribute:Advice',
    'afpattribute:SpecialAnnouncement',
    'afpattribute:PictureProgram'
  ]
};

export const DEFAULT_FIELDS = ['uno', 'status', 'signal', 'advisory', 'headline', 'news', 'lang', 'genre'] as const;

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

  const text = `## ${d.headline}\n*${meta.join(' | ')}*\n\n${body}`;

  return { type: 'text', text };
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

  return { type: 'text', text: `## ${d.headline}\n\n${meta}\n\n---\n\n${body}` };
}

export function textContent(text: string): TextContent {
  return { type: 'text', text };
}

export function toolError(message: string) {
  return {
    isError: true as const,
    content: [textContent(message)]
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
  truncated.push(textContent(
    `\n\n---\n*Response truncated (exceeded ${CHARACTER_LIMIT} characters). Use a smaller \`size\` or add filters to reduce results.*`
  ));
  return truncated;
}

export function buildPaginationLine(shown: number, total: number, offset: number): string {
  const hasMore = total > offset + shown;
  return `*Showing ${shown} of ${total} results (offset: ${offset}).${hasMore ? ` Use offset=${offset + shown} to see more.` : ''}*`;
}
