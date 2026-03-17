import { describe, it, expect } from 'vitest';
import { extractRenditions, formatMediaDocument, formatMediaDocumentsAsJson, formatMediaDocumentsAsCsv, MEDIA_RENDITION_ROLE_MAP } from '../utils/format-media.js';

// Fixture bagItem reprenant la structure réelle AFP
const FIXTURE_BAG_ITEM = [{
  medias: [
    { role: 'Thumbnail',  sizeInBytes: 33590,   width: 320,  height: 213,  href: 'https://example.com/thumb.jpg',   type: 'Photo' },
    { role: 'Preview',    sizeInBytes: 340621,  width: 1200, height: 800,  href: 'https://example.com/prev.jpg',    type: 'Photo' },
    { role: 'Preview_B',  sizeInBytes: 596996,  width: 1800, height: 1200, href: 'https://example.com/prev_b.jpg',  type: 'Photo' },
    { role: 'HighDef',    sizeInBytes: 5126566, width: 3429, height: 2286, href: 'https://example.com/hd.jpg',      type: 'Photo' },
    { role: 'Quicklook',  sizeInBytes: 14055,   width: 245,  height: 164,  href: 'https://example.com/quick.jpg',  type: 'Photo' },
  ],
}];

const FIXTURE_BAG_NO_PREVIEW = [{
  medias: [
    { role: 'Thumbnail', sizeInBytes: 33590, width: 320, height: 213, href: 'https://example.com/thumb.jpg', type: 'Photo' },
    { role: 'Preview_B', sizeInBytes: 596996, width: 1800, height: 1200, href: 'https://example.com/prev_b.jpg', type: 'Photo' },
    { role: 'HighDef',   sizeInBytes: 5126566, width: 3429, height: 2286, href: 'https://example.com/hd.jpg', type: 'Photo' },
  ],
}];

describe('MEDIA_RENDITION_ROLE_MAP', () => {
  it('maps Thumbnail → thumbnail', () => expect(MEDIA_RENDITION_ROLE_MAP['Thumbnail']).toBe('thumbnail'));
  it('maps Preview → preview', () => expect(MEDIA_RENDITION_ROLE_MAP['Preview']).toBe('preview'));
  it('maps Preview_B → preview', () => expect(MEDIA_RENDITION_ROLE_MAP['Preview_B']).toBe('preview'));
  it('maps Preview_W → preview', () => expect(MEDIA_RENDITION_ROLE_MAP['Preview_W']).toBe('preview'));
  it('maps HighDef → highdef', () => expect(MEDIA_RENDITION_ROLE_MAP['HighDef']).toBe('highdef'));
});

describe('extractRenditions', () => {
  it('returns {} for empty bagItem', () => {
    expect(extractRenditions([])).toEqual({});
  });

  it('returns {} for missing medias', () => {
    expect(extractRenditions([{}])).toEqual({});
  });

  it('extracts thumbnail, preview, highdef from standard bagItem', () => {
    const r = extractRenditions(FIXTURE_BAG_ITEM);
    expect(r.thumbnail?.href).toBe('https://example.com/thumb.jpg');
    expect(r.thumbnail?.width).toBe(320);
    expect(r.thumbnail?.sizeInBytes).toBe(33590);
    expect(r.preview?.href).toBe('https://example.com/prev.jpg');
    expect(r.preview?.width).toBe(1200);
    expect(r.highdef?.href).toBe('https://example.com/hd.jpg');
  });

  it('Preview takes priority over Preview_B for the preview slot', () => {
    const r = extractRenditions(FIXTURE_BAG_ITEM);
    expect(r.preview?.width).toBe(1200); // Preview, not Preview_B (1800)
  });

  it('falls back to Preview_B when Preview is absent', () => {
    const r = extractRenditions(FIXTURE_BAG_NO_PREVIEW);
    expect(r.preview?.href).toBe('https://example.com/prev_b.jpg');
    expect(r.preview?.width).toBe(1800);
  });

  it('ignores unknown roles (Quicklook)', () => {
    const r = extractRenditions(FIXTURE_BAG_ITEM);
    expect(Object.keys(r)).not.toContain('quicklook');
  });

  it('uses first bagItem only (index 0)', () => {
    const twoBags = [FIXTURE_BAG_ITEM[0], { medias: [{ role: 'Thumbnail', href: 'https://other.com/thumb.jpg', width: 100, height: 100 }] }];
    const r = extractRenditions(twoBags);
    expect(r.thumbnail?.href).toBe('https://example.com/thumb.jpg');
  });
});

describe('formatMediaDocument', () => {
  const doc = {
    uno: 'newsml.afp.com.20260316T202634Z.doc-a3jc2qq',
    title: 'TOPSHOT-FBL-ENG',
    caption: 'A footballer heads the ball.',
    creditLine: 'JOHN DOE / AFP',
    creator: 'JOHN DOE',
    country: 'GBR',
    city: 'London',
    published: '2026-03-16T22:11:26Z',
    class: 'picture',
    urgency: 3,
    advisory: 'RESTRICTED TO EDITORIAL USE',
    renditions: {
      thumbnail: { href: 'https://example.com/thumb.jpg', width: 320, height: 213 },
      preview:   { href: 'https://example.com/prev.jpg',  width: 1200, height: 800 },
      highdef:   { href: 'https://example.com/hd.jpg',    width: 3429, height: 2286 },
    },
  };

  it('returns { type: "text", text: string }', () => {
    const r = formatMediaDocument(doc);
    expect(r.type).toBe('text');
    expect(typeof r.text).toBe('string');
  });

  it('includes ## title heading', () => {
    expect(formatMediaDocument(doc).text).toContain('## TOPSHOT-FBL-ENG');
  });

  it('includes metadata line (UNO, class, creditLine, city, country)', () => {
    const t = formatMediaDocument(doc).text;
    expect(t).toContain('newsml.afp.com.20260316T202634Z.doc-a3jc2qq');
    expect(t).toContain('picture');
    expect(t).toContain('JOHN DOE / AFP');
    expect(t).toContain('London');
    expect(t).toContain('GBR');
  });

  it('includes inline thumbnail image', () => {
    const t = formatMediaDocument(doc).text;
    expect(t).toContain('![A footballer heads the ball.](https://example.com/thumb.jpg)');
  });

  it('includes preview and highdef links', () => {
    const t = formatMediaDocument(doc).text;
    expect(t).toContain('[Preview 1200px](https://example.com/prev.jpg)');
    expect(t).toContain('[HighDef 3429px](https://example.com/hd.jpg)');
  });

  it('includes advisory as blockquote', () => {
    expect(formatMediaDocument(doc).text).toContain('> RESTRICTED TO EDITORIAL USE');
  });

  it('handles missing renditions gracefully', () => {
    const minimal = { uno: 'TEST', renditions: {} };
    const r = formatMediaDocument(minimal);
    expect(r.type).toBe('text');
    expect(r.text).toContain('TEST');
  });
});

describe('formatMediaDocumentsAsCsv', () => {
  it('includes header row with correct columns', () => {
    const r = formatMediaDocumentsAsCsv([]);
    expect(r.content.text).toContain('uno,title,caption,creditLine,published,class,thumbnail_href');
  });

  it('includes document values in correct column order', () => {
    const docs = [{
      uno: 'newsml.test',
      title: 'My Photo',
      caption: 'A nice caption',
      creditLine: 'JANE / AFP',
      published: '2026-03-16T10:00:00Z',
      class: 'picture',
      renditions: { thumbnail: { href: 'https://example.com/t.jpg', width: 320, height: 213 } },
    }];
    const r = formatMediaDocumentsAsCsv(docs as any);
    expect(r.content.text).toContain('newsml.test');
    expect(r.content.text).toContain('My Photo');
    expect(r.content.text).toContain('JANE / AFP');
    expect(r.content.text).toContain('https://example.com/t.jpg');
  });

  it('escapes commas and quotes in field values', () => {
    const docs = [{
      uno: 'newsml.test',
      caption: 'A caption, with "quotes"',
      renditions: {},
    }];
    const r = formatMediaDocumentsAsCsv(docs as any);
    expect(r.content.text).toContain('"A caption, with ""quotes"""');
  });

  it('handles missing thumbnail href gracefully', () => {
    const docs = [{ uno: 'newsml.test', renditions: {} }];
    const r = formatMediaDocumentsAsCsv(docs as any);
    expect(r.content.text).toContain('newsml.test');
  });
});

describe('formatMediaDocumentsAsJson', () => {
  const docs = [
    { uno: 'A', renditions: { thumbnail: { href: 'https://t.jpg', width: 320, height: 213 } } },
    { uno: 'B', renditions: {} },
  ];

  it('returns { content: TextContent, truncated: boolean }', () => {
    const r = formatMediaDocumentsAsJson(docs as any);
    expect(r.content.type).toBe('text');
    expect(typeof r.truncated).toBe('boolean');
  });

  it('output JSON contains total metadata and documents array', () => {
    const r = formatMediaDocumentsAsJson(docs as any, { total: 100, offset: 0 });
    const parsed = JSON.parse(r.content.text);
    expect(parsed.total).toBe(100);
    expect(parsed.offset).toBe(0);
    expect(parsed.shown).toBe(2);
    expect(parsed.truncated).toBe(false);
    expect(parsed.documents).toHaveLength(2);
    expect(parsed.documents[0].uno).toBe('A');
  });

  it('truncated flag is false when content is small', () => {
    const r = formatMediaDocumentsAsJson(docs as any, { total: 100, offset: 0 });
    expect(r.truncated).toBe(false);
  });

  it('truncates when content exceeds CHARACTER_LIMIT', () => {
    // Generate a large doc list that will exceed 25k chars
    const largeDocs = Array.from({ length: 500 }, (_, i) => ({
      uno: `newsml.afp.com.2026031${i}T202634Z.doc-abcdefg`,
      title: 'A very long title that takes up space in the JSON output',
      caption: 'A very long caption that also takes up considerable space in the JSON output here',
      renditions: { thumbnail: { href: `https://example.com/thumb-${i}.jpg`, width: 320, height: 213 } },
    }));
    const r = formatMediaDocumentsAsJson(largeDocs as any, { total: 500, offset: 0 });
    expect(r.truncated).toBe(true);
    const parsed = JSON.parse(r.content.text);
    expect(parsed.shown).toBeLessThan(500);
  });
});
