import type { AFPDocument } from '../utils/types.js';

export const FIXTURE_DOC: AFPDocument = {
  uno: 'AFP-TEST-001',
  headline: 'Test Article Headline',
  published: '2026-02-14T10:30:00Z',
  lang: 'fr',
  genre: 'news',
  news: [
    'First paragraph of the article.',
    'Second paragraph with more details.',
    'Third paragraph continues.',
    'Fourth paragraph wraps up.',
    'Fifth paragraph is extra content.',
  ],
  status: 'Usable',
  signal: 'update',
  advisory: 'CORRECTION',
};

export const FIXTURE_DOC_MINIMAL: AFPDocument = {
  uno: 'AFP-TEST-002',
  headline: 'Minimal Article',
  published: '2026-02-14T12:00:00Z',
  lang: 'en',
  genre: 'factcheck',
  news: ['Only one paragraph.'],
};

export const FIXTURE_VIDEO_DOC: AFPDocument = {
  uno: 'AFP-TEST-VID-001',
  headline: 'Test Video Headline',
  published: '2026-02-14T10:30:00Z',
  lang: 'fr',
  genre: 'STOCKSHOTS',
  class: 'video',
  news: [
    '1. 00:00-00:12 Vue aérienne de la ville',
    '2. 00:12-00:30 SOUNDBITE 1 - Jean Dupont, témoin',
    '"Tout a commencé très vite"',
  ],
};

export function makeDocs(count: number): AFPDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    uno: `AFP-TEST-${String(i + 1).padStart(3, '0')}`,
    headline: `Article ${i + 1}`,
    published: '2026-02-14T10:00:00Z',
    lang: 'fr',
    genre: 'news',
    news: ['Paragraph 1', 'Paragraph 2'],
  }));
}
