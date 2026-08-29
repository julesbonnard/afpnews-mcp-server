import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import type { ToolResult } from '../utils/types.js';
import { toolError } from '../utils/format.js';
import { formatErrorMessage } from './shared.js';
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
  inputSchema: z.ZodType;
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

// RAW_TOOLS.handler trusts its args are already validated — true when called through
// register.ts (the MCP SDK validates against inputSchema before invoking it), not when a
// consumer calls TOOL_DEFINITIONS[i].handler directly (e.g. afpnews-deck's aiTools.ts, which
// only has inputJsonSchema to describe the tool to the LLM, not to validate its output). So
// TOOL_DEFINITIONS re-validates here — the one place every non-MCP-protocol caller goes
// through — turning a bad/hallucinated arg (e.g. an invented field name) into a clean
// isError result instead of an opaque crash deep in a formatter.
export const TOOL_DEFINITIONS: ToolDefinition[] = RAW_TOOLS.map((t) => ({
  ...t,
  inputJsonSchema: z.toJSONSchema(t.inputSchema),
  handler: async (apicore: ApiCore, args: unknown): Promise<ToolResult> => {
    const parsed = t.inputSchema.safeParse(args);
    if (!parsed.success) {
      return toolError(formatErrorMessage(`validating input for ${t.name}`, parsed.error, 'Check the arguments against the tool schema and try again.'));
    }
    return (t.handler as (apicore: ApiCore, args: unknown) => Promise<ToolResult>)(apicore, parsed.data);
  },
}));
