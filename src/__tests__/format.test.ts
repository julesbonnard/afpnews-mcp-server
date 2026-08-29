import { describe, it, expect } from 'bun:test';
import { parseDocument } from 'afpnews-api';
import { formatDocument, formatFullArticle, pickDocFields, toApiFields, MARKDOWN_API_FIELDS } from '../utils/format.js';
import { FIXTURE_DOC, FIXTURE_DOC_MINIMAL, FIXTURE_VIDEO_DOC } from './fixtures.js';

describe('formatDocument', () => {
  it('returns { type: "text", text: string }', () => {
    const result = formatDocument(parseDocument(FIXTURE_DOC));
    expect(result).toHaveProperty('type', 'text');
    expect(typeof result.text).toBe('string');
    expect(Object.keys(result)).toEqual(['type', 'text']);
  });

  it('includes title as ## heading', () => {
    const result = formatDocument(parseDocument(FIXTURE_DOC));
    expect(result.text).toContain('## Test Article Headline');
  });

  it('includes metadata line with UNO, Lang, Genre (no Published, no Short ID)', () => {
    const result = formatDocument(parseDocument(FIXTURE_DOC));
    expect(result.text).toContain('UNO: AFP-TEST-001');
    expect(result.text).toContain('Lang: fr');
    expect(result.text).toContain('Genre: news');
    expect(result.text).not.toContain('Published:');
    expect(result.text).not.toContain('SHORT_GUID:');
  });

  it('includes optional metadata (status, signal, advisory) when present', () => {
    const result = formatDocument(parseDocument(FIXTURE_DOC));
    expect(result.text).toContain('Status: Usable');
    expect(result.text).toContain('Signal: update');
    expect(result.text).toContain('Advisory: CORRECTION');
  });

  it('omits optional metadata when absent', () => {
    // Status est désormais obligatoire sur AfpDocument (parseDocument() l'exige) — seuls
    // signal/advisory restent réellement optionnels une fois le document parsé.
    const result = formatDocument(parseDocument(FIXTURE_DOC_MINIMAL));
    expect(result.text).not.toContain('Signal:');
    expect(result.text).not.toContain('Advisory:');
  });

  it('truncates to 2 paragraphs when fullText=false', () => {
    const result = formatDocument(parseDocument(FIXTURE_DOC), false);
    expect(result.text).toContain('Second paragraph with more details.');
    expect(result.text).not.toContain('Third paragraph continues.');
  });

  it('includes all paragraphs when fullText=true', () => {
    const result = formatDocument(parseDocument(FIXTURE_DOC), true);
    expect(result.text).toContain('Fifth paragraph is extra content.');
  });

  it('prefixes each returned paragraph with its 1-based raw index, unaffected by the excerpt slice', () => {
    // .slice(0, EXCERPT_PARAGRAPH_COUNT) is a prefix slice, so markers stay 1/2 — same raw index
    // whether the excerpt is 2 paragraphs or the full 5.
    const result = formatDocument(parseDocument(FIXTURE_DOC), false);
    expect(result.text).toContain('[¶1] First paragraph of the article.');
    expect(result.text).toContain('[¶2] Second paragraph with more details.');
  });
});

describe('formatDocument / formatFullArticle — structured paragraph markdown', () => {
  const doc = parseDocument({
    ...FIXTURE_DOC,
    news: [
      'Intro paragraph.',
      '. Section subtitle',
      '— Point A',
      '— Point B',
      'Closing paragraph.',
    ],
  });

  it('renders a subtitle paragraph as a ### heading with its marker', () => {
    const result = formatFullArticle(doc);
    expect(result.text).toContain('### [¶2] Section subtitle');
  });

  it('renders a dash-list block as bullet items, each keeping its own raw index', () => {
    const result = formatFullArticle(doc);
    expect(result.text).toContain('- [¶3] Point A');
    expect(result.text).toContain('- [¶4] Point B');
  });

  it('numbers plain paragraphs around a list block with their real raw index', () => {
    const result = formatFullArticle(doc);
    expect(result.text).toContain('[¶1] Intro paragraph.');
    expect(result.text).toContain('[¶5] Closing paragraph.');
  });
});

describe('MARKDOWN_API_FIELDS', () => {
  // The membership/mandatory-socle behavior is already exercised behaviorally by the
  // toApiFields() tests below (MARKDOWN_API_FIELDS is built by calling it) — only the one
  // deliberate exclusion below documents something toApiFields() doesn't already cover.
  it('does not contain afpshortid (derivable from UNO)', () => {
    expect(MARKDOWN_API_FIELDS).not.toContain('afpshortid');
  });
});

describe('toApiFields', () => {
  it('always includes the mandatory socle required by parseDocument()', () => {
    const fields = toApiFields(['uno', 'headline']);
    expect(fields).toEqual(expect.arrayContaining(['class', 'urgency', 'created', 'published', 'revision', 'provider', 'status', 'lang']));
  });

  it('translates event to the raw afpentity field', () => {
    expect(toApiFields(['event'])).toContain('afpentity');
    expect(toApiFields(['event'])).not.toContain('event');
  });

  it('translates country to both country and countryname raw fields', () => {
    const fields = toApiFields(['country']);
    expect(fields).toContain('country');
    expect(fields).toContain('countryname');
  });

  it('requests fields with no override under their own name', () => {
    expect(toApiFields(['slug'])).toContain('slug');
  });
});

describe('pickDocFields', () => {
  const doc = parseDocument({
    ...FIXTURE_DOC,
    afpshortid: 'abc123',
    country: 'fra',
    countryname: 'France',
    slug: ['sport', 'football'],
    afpentity: { event: [{ qcode: 'afpentity:evt123', keyword: 'afpkeyword:Some Event' }] },
  });

  it('maps afpshortid to shortId', () => {
    expect(pickDocFields(doc, ['afpshortid'])).toEqual({ afpshortid: 'ABC123' });
  });

  it('maps country to its display name, falling back to id', () => {
    expect(pickDocFields(doc, ['country'])).toEqual({ country: 'France' });
  });

  it('maps slug to the slugs array', () => {
    expect(pickDocFields(doc, ['slug'])).toEqual({ slug: ['sport', 'football'] });
  });

  it('maps event to a list of event names', () => {
    expect(pickDocFields(doc, ['event'])).toEqual({ event: ['Some Event'] });
  });

  it('falls back to null for an absent optional field', () => {
    expect(pickDocFields(doc, ['city'])).toEqual({ city: null });
  });
});

describe('formatFullArticle', () => {
  it('uses the shot list as body for a video document', () => {
    const result = formatFullArticle(parseDocument(FIXTURE_VIDEO_DOC));
    expect(result.text).toContain('## Shot list');
    expect(result.text).toContain('1. [00:00-00:12] Vue aérienne de la ville');
    expect(result.text).toContain('2. [00:12-00:30] Jean Dupont, témoin');
    expect(result.text).toContain('   "Tout a commencé très vite"');
    expect(result.text).toContain('**Class:** video');
  });

  it('keeps the plain text body for non-video documents', () => {
    const result = formatFullArticle(parseDocument(FIXTURE_DOC));
    expect(result.text).not.toContain('## Shot list');
    expect(result.text).toContain('First paragraph of the article.');
  });

  it('falls back to an empty body for a video whose news has no parseable shot', () => {
    const doc = parseDocument({ ...FIXTURE_VIDEO_DOC, news: ['no timecode here'] });
    const result = formatFullArticle(doc);
    expect(result.text).not.toContain('## Shot list');
  });
});
