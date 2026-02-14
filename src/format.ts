import type { AFPDocument, FormattedContent } from './types.js';

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

export const DEFAULT_FIELDS = ['uno', 'status', 'signal', 'advisory', 'published', 'headline', 'news', 'lang', 'genre'] as const;

export function formatDocument(doc: unknown, fullText = false): FormattedContent {
  const d = doc as AFPDocument;

  const meta: string[] = [
    `UNO: ${d.uno}`,
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
    : paragraphs.slice(0, 4).join('\n\n');

  const text = `## ${d.headline}\n*${meta.join(' | ')}*\n\n${body}`;

  return { type: 'text', text };
}
