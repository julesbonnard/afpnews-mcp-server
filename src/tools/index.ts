import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import type { ToolResult } from '../utils/types.js';
import { afpSearchArticlesTool } from './search-articles.js';
import { afpGetArticleTool } from './get-article.js';
import { afpFindSimilarTool } from './find-similar.js';
import { afpListFacetsTool } from './list-facets.js';
import { afpSearchMediaTool } from './search-media.js';
import { afpGetMediaTool } from './get-media.js';

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputJsonSchema: unknown;
  handler(apicore: ApiCore, args: unknown): Promise<ToolResult>;
}

const RAW_TOOLS = [
  afpSearchArticlesTool,
  afpGetArticleTool,
  afpFindSimilarTool,
  afpListFacetsTool,
  afpSearchMediaTool,
  afpGetMediaTool,
] as const;

export { RAW_TOOLS };

export const TOOL_DEFINITIONS: ToolDefinition[] = RAW_TOOLS.map((t) => ({
  ...t,
  inputJsonSchema: z.toJSONSchema(t.inputSchema),
}));
