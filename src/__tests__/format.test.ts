import { describe, it, expect } from 'bun:test';
import { formatDocument, formatFullArticle, formatShotList, MARKDOWN_API_FIELDS } from '../utils/format.js';
import { FIXTURE_DOC, FIXTURE_DOC_MINIMAL, FIXTURE_VIDEO_DOC } from './fixtures.js';

describe('formatDocument', () => {
  it('returns { type: "text", text: string }', () => {
    const result = formatDocument(FIXTURE_DOC);
    expect(result).toHaveProperty('type', 'text');
    expect(typeof result.text).toBe('string');
    expect(Object.keys(result)).toEqual(['type', 'text']);
  });

  it('includes title as ## heading', () => {
    const result = formatDocument(FIXTURE_DOC);
    expect(result.text).toContain('## Test Article Headline');
  });

  it('includes metadata line with UNO, Lang, Genre (no Published, no Short ID)', () => {
    const result = formatDocument(FIXTURE_DOC);
    expect(result.text).toContain('UNO: AFP-TEST-001');
    expect(result.text).toContain('Lang: fr');
    expect(result.text).toContain('Genre: news');
    expect(result.text).not.toContain('Published:');
    expect(result.text).not.toContain('SHORT_GUID:');
  });

  it('includes optional metadata (status, signal, advisory) when present', () => {
    const result = formatDocument(FIXTURE_DOC);
    expect(result.text).toContain('Status: Usable');
    expect(result.text).toContain('Signal: update');
    expect(result.text).toContain('Advisory: CORRECTION');
  });

  it('omits optional metadata when absent', () => {
    const result = formatDocument(FIXTURE_DOC_MINIMAL);
    expect(result.text).not.toContain('Status:');
    expect(result.text).not.toContain('Signal:');
    expect(result.text).not.toContain('Advisory:');
  });

  it('truncates to 2 paragraphs when fullText=false', () => {
    const result = formatDocument(FIXTURE_DOC, false);
    expect(result.text).toContain('Second paragraph with more details.');
    expect(result.text).not.toContain('Third paragraph continues.');
  });

  it('includes all paragraphs when fullText=true', () => {
    const result = formatDocument(FIXTURE_DOC, true);
    expect(result.text).toContain('Fifth paragraph is extra content.');
  });
});

describe('MARKDOWN_API_FIELDS', () => {
  it('contains expected fields', () => {
    expect(MARKDOWN_API_FIELDS).toContain('uno');
    expect(MARKDOWN_API_FIELDS).toContain('headline');
    expect(MARKDOWN_API_FIELDS).toContain('news');
    expect(MARKDOWN_API_FIELDS).toContain('lang');
    expect(MARKDOWN_API_FIELDS).toContain('genre');
  });

  it('does not contain published or afpshortid (derivable from UNO)', () => {
    expect(MARKDOWN_API_FIELDS).not.toContain('published');
    expect(MARKDOWN_API_FIELDS).not.toContain('afpshortid');
  });
});

describe('formatShotList', () => {
  it('renders a timecoded shot list for a video document', () => {
    const out = formatShotList(FIXTURE_VIDEO_DOC);
    expect(out).toContain('## Shot list');
    expect(out).toContain('1. [00:00-00:12] Vue aérienne de la ville');
    expect(out).toContain('2. [00:12-00:30] Jean Dupont, témoin');
    expect(out).toContain('   "Tout a commencé très vite"');
  });

  it('returns null for non-video documents', () => {
    expect(formatShotList(FIXTURE_DOC)).toBeNull();
  });

  it('returns null for a video whose news has no parseable shot', () => {
    expect(formatShotList({ class: 'video', news: ['no timecode here'] })).toBeNull();
  });
});

describe('formatFullArticle', () => {
  it('uses the shot list as body for a video document', () => {
    const result = formatFullArticle(FIXTURE_VIDEO_DOC);
    expect(result.text).toContain('## Shot list');
    expect(result.text).toContain('[00:00-00:12] Vue aérienne de la ville');
    expect(result.text).toContain('**Class:** video');
  });

  it('keeps the plain text body for non-video documents', () => {
    const result = formatFullArticle(FIXTURE_DOC);
    expect(result.text).not.toContain('## Shot list');
    expect(result.text).toContain('First paragraph of the article.');
  });
});
