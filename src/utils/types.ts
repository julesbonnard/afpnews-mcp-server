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
  event?: string[];
  'class'?: string;
  revision?: number;
  created?: string;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface MediaRendition {
  href: string;
  width: number;
  height: number;
  sizeInBytes?: number;
  afpType?: string;  // AFP 'type' field (e.g. 'Photo', 'Graphic') — used for MIME type inference
}

export interface MediaRenditions {
  thumbnail?: MediaRendition;
  preview?: MediaRendition;
  highdef?: MediaRendition;
}

export interface AFPMediaDocument {
  uno: string;
  title?: string;
  caption?: string;
  creditLine?: string;
  creator?: string;
  country?: string;
  city?: string;
  published?: string;
  urgency?: number;
  class?: string;
  aspectRatios?: string[];
  advisory?: string;
  renditions: MediaRenditions;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type AnyContent = TextContent | ImageContent;

export interface ToolSuccess {
  content: AnyContent[];
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
  'status', 'signal', 'advisory', 'country', 'city', 'slug', 'event', 'class', 'revision', 'created',
] as const;

export type DocField = typeof ALL_DOC_FIELDS[number];

export const DEFAULT_OUTPUT_FIELDS: DocField[] = ['uno', 'headline', 'lang', 'genre'];
