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
  squared120?: MediaRendition;
  quicklook?: MediaRendition;
  thumbnail?: MediaRendition;
  mockup?: MediaRendition;
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
  isError?: false;
  content: AnyContent[];
}

export interface ToolError {
  isError: true;
  content: TextContent[];
}

export type ToolResult = ToolSuccess | ToolError;

export const ALL_DOC_FIELDS = [
  'afpshortid', 'uno', 'headline', 'published', 'lang', 'genre',
  'status', 'signal', 'advisory', 'country', 'city', 'slug', 'event', 'class', 'revision', 'created',
  'wordCount',
] as const;

export type DocField = typeof ALL_DOC_FIELDS[number];
