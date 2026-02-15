import { describe, it, expect } from 'vitest';
import { formatDocument, DEFAULT_FIELDS } from '../utils/format.js';
import { FIXTURE_DOC, FIXTURE_DOC_MINIMAL } from './fixtures.js';

describe('formatDocument', () => {
  it('returns { type: "text", text: string }', () => {
    const result = formatDocument(FIXTURE_DOC);
    expect(result).toHaveProperty('type', 'text');
    expect(typeof result.text).toBe('string');
    // Should NOT have extra properties like uno, lang, etc.
    expect(Object.keys(result)).toEqual(['type', 'text']);
  });

  it('includes title as ## heading', () => {
    const result = formatDocument(FIXTURE_DOC);
    expect(result.text).toContain('## Test Article Headline');
  });

  it('includes metadata line with UNO, Published, Lang, Genre', () => {
    const result = formatDocument(FIXTURE_DOC);
    expect(result.text).toContain('UNO: AFP-TEST-001');
    expect(result.text).toContain('Published: 2026-02-14T10:30:00Z');
    expect(result.text).toContain('Lang: fr');
    expect(result.text).toContain('Genre: news');
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

  it('truncates to 4 paragraphs when fullText=false', () => {
    const result = formatDocument(FIXTURE_DOC, false);
    expect(result.text).toContain('Fourth paragraph wraps up.');
    expect(result.text).not.toContain('Fifth paragraph is extra content.');
  });

  it('includes all paragraphs when fullText=true', () => {
    const result = formatDocument(FIXTURE_DOC, true);
    expect(result.text).toContain('Fifth paragraph is extra content.');
  });

  it('preserves ISO date string as-is', () => {
    const result = formatDocument(FIXTURE_DOC);
    expect(result.text).toContain('Published: 2026-02-14T10:30:00Z');
  });
});

describe('DEFAULT_FIELDS', () => {
  it('contains expected fields', () => {
    expect(DEFAULT_FIELDS).toContain('uno');
    expect(DEFAULT_FIELDS).toContain('headline');
    expect(DEFAULT_FIELDS).toContain('published');
    expect(DEFAULT_FIELDS).toContain('news');
    expect(DEFAULT_FIELDS).toContain('lang');
    expect(DEFAULT_FIELDS).toContain('genre');
  });
});
