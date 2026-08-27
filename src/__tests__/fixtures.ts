import { parseDocument } from 'afpnews-api';

/** Champs bruts de l'API AFP pour un document — forme d'entrée de parseDocument(), fixtures de test uniquement. */
interface AFPDocument {
  afpshortid?: string;
  uno: string;
  headline: string;
  published: string;
  lang: string;
  genre: string;
  news: string[];
  status?: string;
  signal?: string;
  advisory?: string;
  country?: string;
  city?: string;
  slug?: string[];
  event?: string[];
  'class'?: string;
  revision?: number;
  created?: string;
  urgency?: number;
  provider?: string;
}

/**
 * Parse une liste de fixtures brutes via le vrai parseDocument() du SDK — pour construire une
 * valeur de mock d'apicore.search()/mlt() avec { parse: true }, qui renvoie déjà des AfpDocument.
 */
export function parseFixtures(docs: AFPDocument[]) {
  return docs.map(d => parseDocument(d));
}

// Socle requis par parseDocument() (AfpDocument) — identique sur les 4 fixtures ci-dessous,
// quelles que soient les valeurs des autres champs (voir MANDATORY_RAW_FIELDS côté SDK).
const BASE = {
  urgency: 4,
  revision: 1,
  provider: 'AFP',
  status: 'Usable',
} as const;

export const FIXTURE_DOC: AFPDocument = {
  ...BASE,
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
  signal: 'update',
  advisory: 'CORRECTION',
  'class': 'text',
  created: '2026-02-14T10:00:00Z',
};

export const FIXTURE_DOC_MINIMAL: AFPDocument = {
  ...BASE,
  uno: 'AFP-TEST-002',
  headline: 'Minimal Article',
  published: '2026-02-14T12:00:00Z',
  lang: 'en',
  genre: 'factcheck',
  news: ['Only one paragraph.'],
  'class': 'factcheck',
  created: '2026-02-14T11:00:00Z',
};

export const FIXTURE_VIDEO_DOC: AFPDocument = {
  ...BASE,
  uno: 'AFP-TEST-VID-001',
  headline: 'Test Video Headline',
  published: '2026-02-14T10:30:00Z',
  lang: 'fr',
  genre: 'STOCKSHOTS',
  'class': 'video',
  news: [
    '1. 00:00-00:12 Vue aérienne de la ville',
    '2. 00:12-00:30 SOUNDBITE 1 - Jean Dupont, témoin',
    '"Tout a commencé très vite"',
  ],
  created: '2026-02-14T10:00:00Z',
};

export function makeDocs(count: number): AFPDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    ...BASE,
    uno: `AFP-TEST-${String(i + 1).padStart(3, '0')}`,
    headline: `Article ${i + 1}`,
    published: '2026-02-14T10:00:00Z',
    lang: 'fr',
    genre: 'news',
    news: ['Paragraph 1', 'Paragraph 2'],
    'class': 'text',
    created: '2026-02-14T09:00:00Z',
  }));
}
