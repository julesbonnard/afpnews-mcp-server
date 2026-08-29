import { z } from 'zod';
import { afpSearchArticlesTool } from './search-articles.js';
import { afpGetArticleTool } from './get-article.js';
import { afpFindSimilarTool } from './find-similar.js';
import { afpListFacetsTool } from './list-facets.js';
import { afpSearchMediaTool } from './search-media.js';
import { afpGetMediaTool } from './get-media.js';

// Metadata only — no handler. Executing a tool means going through the real MCP protocol
// (register.ts, or a consumer's own Client/McpServer pair via mcp-server.ts's buildServer),
// which is also where input validation lives.
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  inputJsonSchema: unknown;
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
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: t.inputSchema,
  inputJsonSchema: z.toJSONSchema(t.inputSchema),
}));
