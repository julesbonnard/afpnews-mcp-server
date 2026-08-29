import { z } from 'zod';
import { afpSearchArticlesTool } from './search-articles.js';
import { afpGetArticleTool } from './get-article.js';
import { afpFindSimilarTool } from './find-similar.js';
import { afpListFacetsTool } from './list-facets.js';
import { afpSearchMediaTool } from './search-media.js';
import { afpGetMediaTool } from './get-media.js';

// Metadata only — no handler. Executing a tool means going through the real MCP protocol
// (register.ts, or a consumer's own in-process Client/McpServer pair — see
// afpnews-mcp-server/server's createServerFromApicore), which is also where input validation
// lives. TOOL_DEFINITIONS used to also expose a callable handler for consumers that skipped the
// protocol (afpnews-deck's aiTools.ts, calling it directly with LLM-supplied args) — a bad or
// hallucinated arg would reach the raw handler unvalidated. Now that afpnews-deck calls tools
// through a real in-process Client instead, nothing needs a directly-callable handler here.
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
