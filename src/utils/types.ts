export interface AFPDocument {
  uno: string;
  headline: string;
  published: string;
  lang: string;
  genre: string;
  news: string[];
  status?: string;
  signal?: string;
  advisory?: string;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export type FormattedContent = TextContent;

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
export const DEFAULT_FACET_SIZE = 20;
