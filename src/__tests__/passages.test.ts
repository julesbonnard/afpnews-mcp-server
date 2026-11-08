import { describe, expect, it, mock } from 'bun:test';
import { afpSearchArticlesTool } from '../tools/search-articles.js';
import { afpSearchMediaTool } from '../tools/search-media.js';
import { passagesSchema } from '../utils/passages.js';

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
  ...Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`L${i}`, text(`L${i}`, 'Long', ['Le ministre ' + 'a parlé longuement. '.repeat(400)])]),
  ),
  B: text('B', 'Bavard', Array(10).fill('Le ministre ' + 'a parlé. '.repeat(1200))),
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

const LONG = Array.from({ length: 20 }, (_, i) => `L${i}`);

// Simule la recherche par facets.uno : renvoie les documents demandés, dans l'ordre.
const searchMock = mock(async (request: any) => {
  const documents = [request.uno].flat().filter(uno => DOCS[uno]).map(uno => DOCS[uno]);
  return { documents, count: documents.length };
});
const apicore = { search: searchMock } as any;

const call = (input: Record<string, unknown>) => {
  const { unos, ...passages } = input as { unos: string[] };
  return afpSearchArticlesTool.handler(apicore, { facets: { uno: unos }, passages } as any) as Promise<any>;
};
const run = async (input: Record<string, unknown>) => (await call(input)).content[0].text as string;

describe('afp_search_articles passages', () => {
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

  it('compte les documents sans correspondance', async () => {
    expect(await run({ unos: ['E', 'T'], terms: ['ministre'] })).toContain('1 document(s) without match.');
  });

  it('recherche par UNO sans les filtres par défaut, dimensionnée sur la liste', async () => {
    await run({ unos: ['T', 'V'], terms: ['ministre'] });
    const [request] = searchMock.mock.calls.at(-1)!;
    expect(request.size).toBe(2);
    expect(request.class).toBeUndefined();
    expect(request.genreid).toBeUndefined();
  });

  it('expose le lead en csv', async () => {
    const result: any = await afpSearchArticlesTool.handler(apicore, {
      format: 'csv',
      fields: ['uno', 'lead'],
      facets: { uno: ['T'] },
    } as any);
    expect(result.content[0].text).toBe('uno,lead\nT,Premier paragraphe sans rapport.');
    expect(searchMock.mock.calls.at(-1)![1]).toContain('news');
  });

  it('refuse passages hors markdown', async () => {
    const result: any = await afpSearchArticlesTool.handler(apicore, {
      format: 'json',
      passages: { terms: ['ministre'] },
    } as any);
    expect(result.isError).toBe(true);
  });

  it('cherche aussi dans les plans des vidéos de afp_search_media', async () => {
    const result: any = await afpSearchMediaTool.handler(apicore, {
      facets: { uno: ['V'] },
      passages: { terms: ['céderons'] },
    } as any);
    expect(result.content[0].text).toContain('(t=5&end=12) SOUNDBITE');
  });

  it('exige un début de mot', async () => {
    expect(await run({ unos: ['E'], terms: ['voir'] })).toContain('[¶1] Rien à voir.');
    expect(await run({ unos: ['E'], terms: ['oir'] })).toContain('1 document(s) without match.');
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

  it('refuse un motif invalide', () => {
    expect(passagesSchema.safeParse({ pattern: '(' }).success).toBe(false);
  });

  it('quotesOnly ne garde que les paragraphes cités et les plans avec citation', async () => {
    const out = await run({ unos: ['T'], terms: ['ministre'], quotesOnly: true });
    expect(out).toContain('[¶3]');
    expect(out).not.toContain('[¶2]');
    const video = await run({ unos: ['V'], quotesOnly: true });
    expect(video).toContain('(t=5&end=12)');
    expect(video).not.toContain('PLAN LARGE');
  });

  it('exige des termes, un motif, quotesOnly ou lead', () => {
    expect(passagesSchema.safeParse({}).success).toBe(false);
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
    const out = await run({ unos: LONG, terms: ['ministre'] });
    expect(out).toMatch(/Output limit reached, more matches in: L/);
  });

  it('donne le budget aux meilleurs passages, quel que soit le document', async () => {
    const out = await run({ unos: [...LONG, 'P'], pattern: '45|euro|tonne|ministre' });
    expect(out).toContain('[¶8] Le prix atteint 45 euros la tonne.');
  });

  it('à score égal, sert chaque document avant le deuxième passage d’un autre', async () => {
    const out = await run({ unos: ['B', 'T'], terms: ['ministre'] });
    expect(out).toContain('## Titre');
  });
});
