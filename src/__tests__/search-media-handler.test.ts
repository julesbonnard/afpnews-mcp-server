import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { parseDocument } from 'afpnews-api';
import { afpSearchMediaTool } from '../tools/search-media.js';
import { EMBED_MAX_DOCS } from '../utils/config.js';

const ORIGINAL_FETCH = globalThis.fetch;

// Champs requis par le modèle canonique afpnews-api (AfpDocument) — parseDocument() les exige tous.
const MANDATORY_FIELDS = {
  urgency: 4,
  lang: 'en',
  created: '2026-01-01T00:00:00Z',
  published: '2026-01-01T00:00:00Z',
  revision: 1,
  provider: 'AFP',
  status: 'Usable',
};

function makeMediaDoc(uno: string, extraMedias: Record<string, unknown>[] = []) {
  return parseDocument({
    ...MANDATORY_FIELDS,
    uno,
    title: `Photo ${uno}`,
    'class': 'picture',
    bagItem: [{
      uno,
      caption: 'A caption',
      medias: [
        { role: 'Quicklook', href: `https://example.com/${uno}-quick.jpg`, width: 245, height: 164, type: 'Photo' },
        { role: 'Thumbnail', href: `https://example.com/${uno}-thumb.jpg`, width: 320, height: 213, type: 'Photo' },
        ...extraMedias,
      ],
    }],
  });
}

describe('afpSearchMediaTool.handler — embed', () => {
  beforeEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('rejects embed with a non-markdown format', async () => {
    const apicore = { search: mock() };

    const result = await afpSearchMediaTool.handler(apicore, { query: 'test', embed: true, format: 'json' });

    expect('isError' in result && result.isError).toBe(true);
    expect(apicore.search).not.toHaveBeenCalled();
  });

  it('caps the effective search size to EMBED_MAX_DOCS when embed is true', async () => {
    const apicore = {
      search: mock().mockResolvedValue({ documents: [], count: 0 }),
    };

    await afpSearchMediaTool.handler(apicore, { query: 'test', size: 50, embed: true });

    const [request] = apicore.search.mock.calls[0]!;
    expect(request.size).toBe(EMBED_MAX_DOCS);
  });

  it('does not cap size when embed is false', async () => {
    const apicore = {
      search: mock().mockResolvedValue({ documents: [], count: 0 }),
    };

    await afpSearchMediaTool.handler(apicore, { query: 'test', size: 50 });

    const [request] = apicore.search.mock.calls[0]!;
    expect(request.size).toBe(50);
  });

  it('embeds an image block per result, interleaved with its markdown text', async () => {
    globalThis.fetch = mock().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
    } as Response);

    const apicore = {
      search: mock().mockResolvedValue({
        documents: [makeMediaDoc('MEDIA-1'), makeMediaDoc('MEDIA-2')],
        count: 2,
      }),
    };

    const result = await afpSearchMediaTool.handler(apicore, { query: 'test', embed: true });

    // pagination + (text + image) per doc
    expect(result.content).toHaveLength(1 + 2 * 2);
    expect(result.content[1]).toEqual(expect.objectContaining({ type: 'text' }));
    expect((result.content[1] as { text: string }).text).toContain('MEDIA-1');
    expect(result.content[2]).toEqual(expect.objectContaining({ type: 'image', mimeType: 'image/jpeg' }));
    expect((result.content[3] as { text: string }).text).toContain('MEDIA-2');
    expect(result.content[4]).toEqual(expect.objectContaining({ type: 'image' }));
  });

  it('embeds the thumbnail (poster frame) for video results, not quicklook', async () => {
    globalThis.fetch = mock().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
    } as Response);

    const videoDoc = parseDocument({
      ...MANDATORY_FIELDS,
      uno: 'VIDEO-1',
      title: 'A video',
      'class': 'video',
      bagItem: [{
        uno: 'VIDEO-1',
        medias: [
          { role: 'Quicklook', href: 'https://example.com/video-quick.jpg', width: 245, height: 164, type: 'Photo' },
          { role: 'Thumbnail', href: 'https://example.com/video-thumb.jpg', width: 320, height: 213, type: 'Photo' },
        ],
      }],
    });
    const apicore = { search: mock().mockResolvedValue({ documents: [videoDoc], count: 1 }) };

    await afpSearchMediaTool.handler(apicore, { query: 'test', class: 'video', embed: true });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    expect(fetchMock.mock.calls[0]![0]).toBe('https://example.com/video-thumb.jpg');
  });

  it('skips embedding SVG graphics but still returns their metadata text', async () => {
    const svgDoc = parseDocument({
      ...MANDATORY_FIELDS,
      uno: 'GRAPHIC-1',
      title: 'A graphic',
      'class': 'graphic',
      bagItem: [{
        uno: 'GRAPHIC-1',
        medias: [{ role: 'Preview', href: 'https://example.com/graphic.svg', width: 1200, height: 800, type: 'Graphic' }],
      }],
    });
    const apicore = { search: mock().mockResolvedValue({ documents: [svgDoc], count: 1 }) };

    const result = await afpSearchMediaTool.handler(apicore, { query: 'test', class: 'graphic', embed: true });

    expect(result.content.some((c: any) => c.type === 'image')).toBe(false);
    expect(result.content.some((c: any) => c.type === 'text' && c.text.includes('GRAPHIC-1'))).toBe(true);
  });
});
