import { describe, it, expect, mock } from 'bun:test';
import { parseDocument } from 'afpnews-api';
import { afpSearchArticlesTool } from '../tools/search-articles.js';
import { afpSearchMediaTool } from '../tools/search-media.js';
import { FIXTURE_DOC, parseFixtures } from './fixtures.js';

describe('tool defaults', () => {
  it('afp_search_articles defaults to AFP French text documents', async () => {
    const apicore = {
      search: mock().mockResolvedValue({ documents: parseFixtures([FIXTURE_DOC]), count: 1 }),
    };

    await afpSearchArticlesTool.handler(apicore, { query: 'test' });

    const [request] = apicore.search.mock.calls[0]!;
    expect(request.class).toEqual(['text', 'multimedia']);
    expect(request.provider).toEqual(['afp', 'أ ف ب']);
    expect(request.langs).toBeUndefined();
  });

  it('afp_search_media defaults to AFP provider only', async () => {
    const apicore = {
      search: mock().mockResolvedValue({
        documents: [parseDocument({
          uno: 'MEDIA-001',
          title: 'Photo',
          'class': 'picture',
          bagItem: [{ uno: 'MEDIA-001', caption: 'Caption', medias: [{ role: 'Thumbnail', href: 'https://example.com/thumb.jpg', width: 320, height: 213, type: 'Photo' }] }],
          // Requis par le modèle canonique afpnews-api (AfpDocument) — parseDocument() les exige tous.
          urgency: 4, lang: 'en', created: '2026-01-01T00:00:00Z', published: '2026-01-01T00:00:00Z',
          revision: 1, provider: 'AFP', status: 'Usable',
        })],
        count: 1,
      }),
    };

    await afpSearchMediaTool.handler(apicore, { query: 'test', class: 'picture' });

    const [request] = apicore.search.mock.calls[0]!;
    expect(request.class).toEqual(['picture']);
    expect(request.provider).toEqual(['afp', 'أ ف ب']);
  });

  // afp_list_facets' defaults are already asserted in full (class/provider/langs/size) by
  // 'applies AFP text defaults with explicit lang outside preset' in list-facets.test.ts.
});

describe('afp_search_articles duplicates', () => {
  const doc = (uno: string, cls: string, published: string, afpshortid = 'ABC123') =>
    ({ ...FIXTURE_DOC, uno, 'class': cls, published, afpshortid });

  it('keeps the latest version of a story present in text and multimedia, and paginates on raw results', async () => {
    const apicore = {
      search: mock().mockResolvedValue({
        documents: parseFixtures([
          doc('T1', 'text', '2026-02-14T10:30:00Z'),
          doc('M1', 'multimedia', '2026-02-14T11:00:00Z'),
          doc('T2', 'text', '2026-02-14T09:00:00Z', 'XYZ789'),
        ]),
        count: 10,
      }),
    };
    const result = await afpSearchArticlesTool.handler(apicore, { query: 'test', format: 'json' });
    const json = JSON.parse(result.content[0]!.text);
    expect(json.documents.map((d: { uno: string }) => d.uno)).toEqual(['M1', 'T2']);
    expect(json.duplicatesMerged).toBe(1);
    expect(json.nextOffset).toBe(3);
    expect(apicore.search.mock.calls[0]![1]).toContain('afpshortid');

    const md = await afpSearchArticlesTool.handler(apicore, { query: 'test' });
    expect(md.content[0]!.text).toContain('Use `offset: 3`');
    expect(md.content[0]!.text).toContain('1 duplicate(s)');
  });
});
