import { describe, it, expect } from 'vitest';
import { inferMimeType, selectRenditionForEmbed } from '../tools/get-media.js';
import type { MediaRenditions } from '../utils/types.js';

describe('inferMimeType', () => {
  it('maps AFP type "Photo" → image/jpeg (priority over URL extension)', () => {
    expect(inferMimeType('Photo', 'https://example.com/img.jpg')).toBe('image/jpeg');
  });
  it('maps AFP type "Graphic" → image/png', () => {
    expect(inferMimeType('Graphic', 'https://example.com/img.png')).toBe('image/png');
  });
  it('falls back to URL extension .png → image/png when afpType undefined', () => {
    expect(inferMimeType(undefined, 'https://example.com/img.png')).toBe('image/png');
  });
  it('falls back to URL extension .webp → image/webp', () => {
    expect(inferMimeType(undefined, 'https://example.com/img.webp')).toBe('image/webp');
  });
  it('strips query string before checking extension', () => {
    expect(inferMimeType(undefined, 'https://example.com/img.jpg?token=abc123')).toBe('image/jpeg');
  });
  it('falls back to image/jpeg for unknown extension', () => {
    expect(inferMimeType(undefined, 'https://example.com/img?token=abc')).toBe('image/jpeg');
  });
});

describe('selectRenditionForEmbed', () => {
  const renditions: MediaRenditions = {
    thumbnail: { href: 'https://example.com/thumb.jpg', width: 320, height: 213, sizeInBytes: 33590 },
    preview:   { href: 'https://example.com/prev.jpg',  width: 1200, height: 800, sizeInBytes: 340621 },
    highdef:   { href: 'https://example.com/hd.jpg',    width: 3429, height: 2286, sizeInBytes: 5126566 },
  };

  it('returns requested rendition when available and under size limit', () => {
    const r = selectRenditionForEmbed(renditions, 'preview');
    expect(r?.href).toBe('https://example.com/prev.jpg');
  });

  it('downgrades to thumbnail when selected rendition exceeds 5MB', () => {
    const r = selectRenditionForEmbed(renditions, 'highdef');
    // highdef is 5126566 bytes (> 5000000) → downgrade to thumbnail
    expect(r?.href).toBe('https://example.com/thumb.jpg');
  });

  it('falls back to preview then thumbnail when requested rendition absent', () => {
    const noHighdef: MediaRenditions = {
      thumbnail: { href: 'https://example.com/thumb.jpg', width: 320, height: 213, sizeInBytes: 33590 },
      preview:   { href: 'https://example.com/prev.jpg',  width: 1200, height: 800, sizeInBytes: 340621 },
    };
    const r = selectRenditionForEmbed(noHighdef, 'highdef');
    expect(r?.href).toBe('https://example.com/prev.jpg');
  });

  it('returns thumbnail when all larger renditions absent', () => {
    const thumbOnly: MediaRenditions = {
      thumbnail: { href: 'https://example.com/thumb.jpg', width: 320, height: 213, sizeInBytes: 33590 },
    };
    const r = selectRenditionForEmbed(thumbOnly, 'preview');
    expect(r?.href).toBe('https://example.com/thumb.jpg');
  });

  it('returns undefined when no renditions available', () => {
    const r = selectRenditionForEmbed({}, 'preview');
    expect(r).toBeUndefined();
  });
});
