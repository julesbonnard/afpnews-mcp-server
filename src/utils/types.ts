export interface AFPDocument {
  afpshortid?: string;
  uno: string;
  headline: string;
  published: string;
  lang: string;
  genre: string;
  news: string[];
  status?: string;
  signal?: string;
  advisory?: string;
  country?: string;
  city?: string;
  slug?: string[];
  product?: string;
  revision?: number;
  created?: string;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ToolSuccess {
  content: TextContent[];
}

export interface ToolError {
  isError: true;
  content: TextContent[];
}

export type ToolResult = ToolSuccess | ToolError;

export const EXCERPT_PARAGRAPH_COUNT = 4;
export const CHARACTER_LIMIT = 25_000;
export const DEFAULT_SEARCH_SIZE = 10;

export const ALL_DOC_FIELDS = [
  'afpshortid', 'uno', 'headline', 'published', 'lang', 'genre',
  'status', 'signal', 'advisory', 'country', 'city', 'slug', 'product', 'revision', 'created',
] as const;

export type DocField = typeof ALL_DOC_FIELDS[number];

export const DEFAULT_OUTPUT_FIELDS: DocField[] = ['uno', 'headline', 'lang', 'genre'];
