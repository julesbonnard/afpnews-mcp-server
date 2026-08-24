import { describe, it, expect } from 'bun:test';
import { parseDocument } from 'afpnews-api';
import { formatDocument, MARKDOWN_API_FIELDS } from '../utils/format.js';
import { FIXTURE_DOC, FIXTURE_DOC_MINIMAL } from './fixtures.js';

const DOC = parseDocument(FIXTURE_DOC);
const DOC_MINIMAL = parseDocument(FIXTURE_DOC_MINIMAL);

describe('formatDocument', () => {
  it('returns { type: "text", text: string }', () => {
    const result = formatDocument(DOC);
    expect(result).toHaveProperty('type', 'text');
    expect(typeof result.text).toBe('string');
    expect(Object.keys(result)).toEqual(['type', 'text']);
  });

  it('includes title as ## heading', () => {
    const result = formatDocument(DOC);
    expect(result.text).toContain('## Test Article Headline');
  });

  it('includes metadata line with UNO, Lang, Genre (no Published, no Short ID)', () => {
    const result = formatDocument(DOC);
    expect(result.text).toContain('UNO: AFP-TEST-001');
    expect(result.text).toContain('Lang: fr');
    expect(result.text).toContain('Genre: news');
    expect(result.text).not.toContain('Published:');
    expect(result.text).not.toContain('SHORT_GUID:');
  });

  it('includes optional metadata (status, signal, advisory) when present', () => {
    const result = formatDocument(DOC);
    expect(result.text).toContain('Status: Usable');
    expect(result.text).toContain('Signal: update');
    expect(result.text).toContain('Advisory: CORRECTION');
  });

  it('omits optional metadata when absent', () => {
    const result = formatDocument(DOC_MINIMAL);
    expect(result.text).not.toContain('Signal:');
    expect(result.text).not.toContain('Advisory:');
    expect(result.text).not.toContain('Event:');
  });

  it('truncates to 4 paragraphs when fullText=false', () => {
    const result = formatDocument(DOC, false);
    expect(result.text).toContain('Fourth paragraph wraps up.');
    expect(result.text).not.toContain('Fifth paragraph is extra content.');
  });

  it('includes all paragraphs when fullText=true', () => {
    const result = formatDocument(DOC, true);
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

  it('contains the fields the canonical model requires to parse', () => {
    // Sans ça, parseDocument() échoue systématiquement sur les résultats de recherche.
    expect(MARKDOWN_API_FIELDS).toContain('class');
    expect(MARKDOWN_API_FIELDS).toContain('urgency');
    expect(MARKDOWN_API_FIELDS).toContain('created');
    expect(MARKDOWN_API_FIELDS).toContain('published');
    expect(MARKDOWN_API_FIELDS).toContain('revision');
    expect(MARKDOWN_API_FIELDS).toContain('provider');
  });
});
