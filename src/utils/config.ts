import type { DocField } from './types.js';

export const EXCERPT_PARAGRAPH_COUNT = 2;
export const CHARACTER_LIMIT = 100_000;
export const DEFAULT_SEARCH_SIZE = 10;

// Fetching + base64-encoding images is costly: cap how many results get embedded per call,
// regardless of the requested `size` (see search-media's handler: `size` itself is clamped when embed is true).
export const EMBED_MAX_DOCS = 5;

export const DEFAULT_OUTPUT_FIELDS: DocField[] = ['uno', 'headline', 'lang', 'genre'];
