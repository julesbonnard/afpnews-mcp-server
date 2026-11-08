import { describe, expect, it, mock } from 'bun:test';
import { afpFindPassagesTool } from '../tools/find-passages.js';

const text = (uno: string, headline: string, paragraphs: string[]) => ({
  uno,
  class: 'text',
  headline,
  published: new Date('2026-11-01T10:00:00Z'),
  paragraphs: paragraphs.map(p => ({ text: p })),
});

const DOCS: Record<string, unknown> = {
  T: text('T', 'Titre', [
    'Premier paragraphe sans rapport.',
    'Le ministre a été interrogé.',
    '"Nous ne céderons pas", a déclaré le Ministre devant les élus.',
    'Suite du texte.',
    'Encore autre chose.',
    'Les élections auront lieu en mars.',
  ]),
  V: {
    uno: 'V',
    class: 'video',
    headline: 'Vidéo',
    published: new Date('2026-11-02T10:00:00Z'),
    paragraphs: [],
    caption: 'Légende de la vidéo',
    shots: [
      { numero: 1, start: '00:00', end: '00:05', startSec: 0, endSec: 5, description: 'PLAN LARGE', citations: [] },
      {
        numero: 2,
        start: '00:05',
        end: '00:12',
        startSec: 5,
        endSec: 12,
        description: 'SOUNDBITE',
        citations: [{ text: 'Nous ne céderons pas' }],
      },
    ],
  },
  L: text('L', 'Long', ['Le ministre ' + 'a parlé longuement. '.repeat(150)]),
  B: text('B', 'Bavard', Array(10).fill('Le ministre ' + 'a parlé. '.repeat(300))),
  P: text('P', 'Carbone', [
    'Réforme du marché européen.',
    'La Commission européenne hésite.',
    'Les États européens divisés.',
    'Les industriels européens inquiets.',
    'Le Parlement européen attend.',
    'Les ONG européennes mobilisées.',
    'Le Conseil européen tranchera.',
    'Le prix atteint 45 euros la tonne.',
  ]),
  E: text('E', 'Autre', ['Rien à voir.']),
};

const apicore = {
  get: mock(async (uno: string) => {
    if (!DOCS[uno]) throw new Error(`Document "${uno}" not found`);
    return DOCS[uno];
  }),
} as any;

const run = async (input: Record<string, unknown>) => {
  const result: any = await afpFindPassagesTool.handler(apicore, input as any);
  return result.content[0].text as string;
};

describe('afp_find_passages', () => {
  it('renvoie les paragraphes trouvés avec leur [¶n] et leurs voisins', async () => {
    const out = await run({ unos: ['T'], terms: ['ministre'], context: 1 });
    expect(out).toContain('[¶2] Le ministre a été interrogé.');
    expect(out).toContain('[¶3] "Nous ne céderons pas"');
    expect(out).toContain('[¶4] Suite du texte.');
    expect(out).not.toContain('[¶6]');
  });

  it('sans context, ne renvoie que les paragraphes trouvés', async () => {
    const out = await run({ unos: ['T'], terms: ['élections'] });
    expect(out).toContain('[¶6]');
    expect(out).not.toContain('[¶5]');
  });

  it('ignore casse et accents, et marque les sauts', async () => {
    const out = await run({ unos: ['T'], terms: ['MINISTRE', 'election'] });
    expect(out).toContain('[¶6] Les élections');
    expect(out).toContain('[…]');
  });

  it('cherche dans les plans et citations sonores des vidéos', async () => {
    const out = await run({ unos: ['V'], terms: ['céderons'] });
    expect(out).toContain('2. [00:05-00:12] (t=5&end=12) SOUNDBITE');
    expect(out).toContain('"Nous ne céderons pas"');
    expect(out).not.toContain('PLAN LARGE');
  });

  it('liste les documents sans correspondance ou introuvables', async () => {
    const out = await run({ unos: ['E', 'X'], terms: ['ministre'] });
    expect(out).toContain('No match in: E');
    expect(out).toContain('Not found: X');
  });

  it('exige un début de mot', async () => {
    expect(await run({ unos: ['E'], terms: ['voir'] })).toContain('[¶1] Rien à voir.');
    expect(await run({ unos: ['E'], terms: ['oir'] })).toContain('No match in: E');
  });

  it('accepte une expression régulière, avec ou sans accents', async () => {
    const out = await run({ unos: ['T'], pattern: 'c[eé]derons? pas' });
    expect(out).toContain('[¶3]');
    expect(out).not.toContain('[¶2]');
  });

  it('classe en tête les paragraphes qui matchent le plus d’alternatives du motif', async () => {
    const out = await run({ unos: ['P'], pattern: '45|euro|tonne' });
    expect(out).toContain('[¶8] Le prix atteint 45 euros la tonne.');
  });

  it('renvoie une erreur lisible pour un motif invalide', async () => {
    const result: any = await afpFindPassagesTool.handler(apicore, { unos: ['T'], pattern: '(' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Invalid pattern/);
  });

  it('quotesOnly ne garde que les paragraphes cités et les plans avec citation', async () => {
    const out = await run({ unos: ['T'], terms: ['ministre'], quotesOnly: true });
    expect(out).toContain('[¶3]');
    expect(out).not.toContain('[¶2]');
    const video = await run({ unos: ['V'], quotesOnly: true });
    expect(video).toContain('(t=5&end=12)');
    expect(video).not.toContain('PLAN LARGE');
  });

  it('exige des termes, un motif, quotesOnly ou lead', async () => {
    const result: any = await afpFindPassagesTool.handler(apicore, { unos: ['T'] });
    expect(result.isError).toBe(true);
  });

  it('lead seul renvoie le début de chaque document', async () => {
    const out = await run({ unos: ['T', 'E', 'V'], lead: true });
    expect(out).toContain('[¶1] Premier paragraphe sans rapport.');
    expect(out).not.toContain('[¶2]');
    expect(out).toContain('[¶1] Rien à voir.');
    expect(out).toContain('Caption: Légende de la vidéo');
  });

  it('lead ajoute le premier paragraphe aux passages trouvés', async () => {
    const out = await run({ unos: ['T'], terms: ['élections'], lead: true });
    expect(out).toContain('[¶1] Premier paragraphe');
    expect(out).toContain('[…]');
    expect(out).toContain('[¶6] Les élections');
  });

  it('liste les documents au-delà du budget de sortie', async () => {
    const out = await run({ unos: Array(20).fill('L'), terms: ['ministre'] });
    expect(out).toMatch(/Output limit reached, more matches in: L/);
  });

  it('donne le budget aux meilleurs passages, quel que soit le document', async () => {
    const out = await run({ unos: [...Array(20).fill('L'), 'P'], pattern: '45|euro|tonne|ministre' });
    expect(out).toContain('[¶8] Le prix atteint 45 euros la tonne.');
  });

  it('à score égal, sert chaque document avant le deuxième passage d’un autre', async () => {
    const out = await run({ unos: ['B', 'T'], terms: ['ministre'] });
    expect(out).toContain('## Titre');
  });
});
