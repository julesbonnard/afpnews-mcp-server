import { describe, it, expect, mock } from 'bun:test';
import { parseDocument } from 'afpnews-api';
import { afpSearchArticlesTool } from '../tools/search-articles.js';
import { afpSearchMediaTool } from '../tools/search-media.js';
import { afpListFacetsTool } from '../tools/list-facets.js';
import { FIXTURE_DOC, parseFixtures } from './fixtures.js';

describe('tool defaults', () => {
  it('afp_search_articles defaults to AFP French text documents', async () => {
    const apicore = {
      search: mock().mockResolvedValue({ documents: parseFixtures([FIXTURE_DOC]), count: 1 }),
    };

    await afpSearchArticlesTool.handler(apicore, { query: 'test' });

    const [request] = apicore.search.mock.calls[0]!;
    expect(request.class).toEqual(['text']);
    expect(request.provider).toEqual(['afp']);
    expect(request.langs).toEqual(['fr']);
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
    expect(request.provider).toEqual(['afp']);
  });

  it('afp_list_facets defaults to AFP text documents', async () => {
    const apicore = {
      list: mock().mockResolvedValue({ keywords: [{ name: 'economy', count: 42 }] }),
    };

    await afpListFacetsTool.handler(apicore, { facet: 'slug' });

    const [, params] = apicore.list.mock.calls[0]!;
    expect(params.class).toEqual(['text']);
    expect(params.provider).toEqual(['afp']);
  });
});
