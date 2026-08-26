import { parseDocument } from 'afpnews-api';
import type { AFPDocument } from '../utils/types.js';

/**
 * Parse une liste de fixtures brutes via le vrai parseDocument() du SDK — pour construire une
 * valeur de mock d'apicore.search()/mlt() avec { parse: true }, qui renvoie déjà des AfpDocument.
 */
export function parseFixtures(docs: AFPDocument[]) {
  return docs.map(d => parseDocument(d));
}

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
  // Requis par le modèle canonique afpnews-api (AfpDocument) — parseDocument() les exige tous.
  'class': 'text',
  urgency: 4,
  created: '2026-02-14T10:00:00Z',
  revision: 1,
  provider: 'AFP',
};

export const FIXTURE_DOC_MINIMAL: AFPDocument = {
  uno: 'AFP-TEST-002',
  headline: 'Minimal Article',
  published: '2026-02-14T12:00:00Z',
  lang: 'en',
  genre: 'factcheck',
  news: ['Only one paragraph.'],
  // Requis par le modèle canonique afpnews-api (AfpDocument) — parseDocument() les exige tous.
  'class': 'factcheck',
  urgency: 4,
  created: '2026-02-14T11:00:00Z',
  revision: 1,
  provider: 'AFP',
  status: 'Usable',
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
  urgency: 4,
  created: '2026-02-14T10:00:00Z',
  revision: 1,
  provider: 'AFP',
  status: 'Usable',
};

export function makeDocs(count: number): AFPDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    uno: `AFP-TEST-${String(i + 1).padStart(3, '0')}`,
    headline: `Article ${i + 1}`,
    published: '2026-02-14T10:00:00Z',
    lang: 'fr',
    genre: 'news',
    news: ['Paragraph 1', 'Paragraph 2'],
    'class': 'text',
    urgency: 4,
    created: '2026-02-14T09:00:00Z',
    revision: 1,
    provider: 'AFP',
    status: 'Usable',
  }));
}
