import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { parseDocument } from 'afpnews-api';
import { afpGetMediaTool } from '../tools/get-media.js';

const ORIGINAL_FETCH = globalThis.fetch;

function getText(result: any, index = 0): string {
  return result.content[index]?.text ?? '';
}

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

describe('afpGetMediaTool.handler', () => {
  beforeEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  // `beforeEach` only guards tests within this file — without this, a mock
  // left on `globalThis.fetch` by this file's last test leaks into whichever
  // test file bun:test happens to run next (e.g. any test hitting a real
  // HTTP server via `fetch()`).
  afterAll(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('returns error when media document is missing', async () => {
    // apicore.get(uno, { parse: true }) lève sur un UNO inexistant (confirmé en conditions
    // réelles : 404 ApiError), il ne renvoie jamais de valeur "vide".
    const apicore = { get: mock().mockRejectedValue(new Error('Document "MISSING" not found')) };

    const result = await afpGetMediaTool.handler(apicore, { uno: 'MISSING' });

    expect('isError' in result && result.isError).toBe(true);
    expect(getText(result)).toContain('not found');
  });

  it('returns metadata only when embed=false', async () => {
    const apicore = {
      get: mock().mockResolvedValue(parseDocument({
        ...MANDATORY_FIELDS,
        uno: 'MEDIA-001',
        title: 'Photo',
        'class': 'picture',
        creditLine: 'AFP',
        bagItem: [{ uno: 'MEDIA-001', medias: [{ role: 'Thumbnail', href: 'https://example.com/thumb.jpg', width: 320, height: 200, type: 'Photo' }] }],
      })),
    };

    const result = await afpGetMediaTool.handler(apicore, { uno: 'MEDIA-001' });

    expect(result.content).toHaveLength(1);
    expect(getText(result)).toContain('## Photo');
    expect(getText(result)).toContain('thumbnail: https://example.com/thumb.jpg');
  });

  it('warns when trying to embed an SVG graphic', async () => {
    const apicore = {
      get: mock().mockResolvedValue(parseDocument({
        ...MANDATORY_FIELDS,
        uno: 'GRAPHIC-001',
        title: 'Graphic',
        'class': 'graphic',
        bagItem: [{ uno: 'GRAPHIC-001', medias: [{ role: 'Preview', href: 'https://example.com/graphic.svg', width: 1200, height: 800, type: 'Graphic' }] }],
      })),
    };

    const result = await afpGetMediaTool.handler(apicore, { uno: 'GRAPHIC-001', embed: true });

    expect(result.content).toHaveLength(2);
    expect(getText(result, 1)).toContain('SVG graphics cannot be embedded');
  });

  it('warns when no rendition is available for embedding', async () => {
    const apicore = {
      get: mock().mockResolvedValue(parseDocument({
        ...MANDATORY_FIELDS,
        uno: 'MEDIA-EMPTY',
        title: 'Empty',
        'class': 'picture',
        bagItem: [],
      })),
    };

    const result = await afpGetMediaTool.handler(apicore, { uno: 'MEDIA-EMPTY', embed: true });

    expect(result.content).toHaveLength(2);
    expect(getText(result, 1)).toContain('no rendition available');
  });

  it('embeds a video thumbnail and adds the poster-frame note', async () => {
    globalThis.fetch = mock().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
    } as Response);

    const apicore = {
      get: mock().mockResolvedValue(parseDocument({
        ...MANDATORY_FIELDS,
        uno: 'VIDEO-001',
        title: 'Video',
        'class': 'video',
        bagItem: [{ uno: 'VIDEO-001', medias: [{ role: 'Thumbnail', href: 'https://example.com/poster.jpg', width: 320, height: 180, type: 'Photo' }] }],
      })),
    };

    const result = await afpGetMediaTool.handler(apicore, { uno: 'VIDEO-001', embed: true, rendition: 'highdef' });

    expect(result.content).toHaveLength(2);
    expect(getText(result)).toContain('poster frame only');
    // data: base64 réel des octets [1,2,3] — verrouille l'encodage (toBase64, portable
    // navigateur/Bun/Workers), pas juste la présence d'un block image.
    expect(result.content[1]).toEqual(expect.objectContaining({ type: 'image', mimeType: 'image/jpeg', data: 'AQID' }));
  });

  it('returns a warning when image fetch fails', async () => {
    globalThis.fetch = mock().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers(),
    } as Response);

    const apicore = {
      get: mock().mockResolvedValue(parseDocument({
        ...MANDATORY_FIELDS,
        uno: 'MEDIA-403',
        title: 'Photo',
        'class': 'picture',
        bagItem: [{ uno: 'MEDIA-403', medias: [{ role: 'Preview', href: 'https://example.com/prev.jpg', width: 1200, height: 800, type: 'Photo' }] }],
      })),
    };

    const result = await afpGetMediaTool.handler(apicore, { uno: 'MEDIA-403', embed: true });

    expect(result.content).toHaveLength(2);
    expect(getText(result, 1)).toContain('image embed failed');
    expect(getText(result, 1)).toContain('HTTP 403');
  });
});
