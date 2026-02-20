import type { AFPDocument, TextContent } from './types.js';
import { EXCERPT_PARAGRAPH_COUNT, CHARACTER_LIMIT } from './types.js';

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

export const DEFAULT_FIELDS = ['afpshortid', 'uno', 'status', 'signal', 'advisory', 'published', 'headline', 'news', 'lang', 'genre'] as const;

export function formatDocument(doc: unknown, fullText = false): TextContent {
  const d = doc as AFPDocument;

  const meta: string[] = [
    `UNO: ${d.uno}`,
    `SHORT_GUID: ${d.afpshortid}`,
    `Published: ${typeof d.published === 'string' ? d.published : new Date(d.published).toISOString()}`,
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
