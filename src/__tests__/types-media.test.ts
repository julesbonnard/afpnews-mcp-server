import { describe, it, expect } from 'vitest';
import type { AFPMediaDocument, MediaRendition, MediaRenditions, ImageContent, AnyContent, ToolSuccess } from '../utils/types.js';

describe('AFPMediaDocument type', () => {
  it('accepts a full media document', () => {
    const doc: AFPMediaDocument = {
      uno: 'newsml.afp.com.20260316T202634Z.doc-a3jc2qq',
      title: 'TOPSHOT-FBL-ENG',
      caption: 'A footballer heads the ball.',
      creditLine: 'JOHN DOE / AFP',
      creator: 'JOHN DOE',
      country: 'GBR',
      city: 'London',
      published: '2026-03-16T22:11:26Z',
      urgency: 3,
      class: 'picture',
      aspectRatios: ['afparatio:horizontal'],
      advisory: 'RESTRICTED TO EDITORIAL USE',
      renditions: {
        thumbnail: { href: 'https://example.com/thumb.jpg', width: 320, height: 213, sizeInBytes: 33590, afpType: 'Photo' },
        preview:   { href: 'https://example.com/prev.jpg',  width: 1200, height: 800 },
        highdef:   { href: 'https://example.com/hd.jpg',    width: 3429, height: 2286 },
      },
    };
    expect(doc.uno).toBe('newsml.afp.com.20260316T202634Z.doc-a3jc2qq');
    expect(doc.renditions.thumbnail?.width).toBe(320);
    expect(doc.renditions.thumbnail?.afpType).toBe('Photo');
  });

  it('accepts a minimal media document (only uno + renditions required)', () => {
    const doc: AFPMediaDocument = { uno: 'TEST', renditions: {} };
    expect(doc.uno).toBe('TEST');
  });

  it('ImageContent has type "image", data string, mimeType string', () => {
    const img: ImageContent = { type: 'image', data: 'base64==', mimeType: 'image/jpeg' };
    expect(img.type).toBe('image');
  });

  it('ToolSuccess accepts mixed AnyContent array', () => {
    const success: ToolSuccess = {
      content: [
        { type: 'text', text: 'metadata' },
        { type: 'image', data: 'base64==', mimeType: 'image/jpeg' },
      ],
    };
    expect(success.content).toHaveLength(2);
  });
});
