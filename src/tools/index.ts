import { z } from 'zod';
import type { ApiCore } from 'afpnews-api';
import type { ToolResult } from '../utils/types.js';
import { afpSearchArticlesTool } from './search-articles.js';
import { afpGetArticleTool } from './get-article.js';
import { afpFindSimilarTool } from './find-similar.js';
import { afpListFacetsTool } from './list-facets.js';
import { afpSearchMediaTool } from './search-media.js';
import { afpGetMediaTool } from './get-media.js';

// `handler` uses method shorthand (not `handler: (...) => ...`) on purpose: each tool's real
// handler takes a narrower `apicore` (Pick<ApiCore, 'get'|'search'|...>) and a specific args type
// (its own zod-inferred input), not `ApiCore`/`unknown`. TS checks method-shaped parameters
// bivariantly, so each tool still satisfies this common shape without a cast — a plain function
// property (`handler: (a, b) => ...`) would be checked contravariantly and reject every tool here.
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputJsonSchema: unknown;
  handler(apicore: ApiCore, args: unknown): Promise<ToolResult>;
}

// RAW_TOOLS keeps its precise, inferred-per-tool type (`as const`, no annotation): registerTools()
// needs each tool's own concrete zod inputSchema type for the MCP SDK's registerTool() overloads —
// widening it to ToolDefinition's `inputJsonSchema`-shaped contract breaks that overload match.
const RAW_TOOLS = [
  afpSearchArticlesTool,
  afpGetArticleTool,
  afpFindSimilarTool,
  afpListFacetsTool,
  afpSearchMediaTool,
  afpGetMediaTool,
] as const;

export { RAW_TOOLS };

// Explicit ToolDefinition[] annotation: the public, uniform contract external consumers (e.g.
// afpnews-deck) call generically across all 6 tools.
export const TOOL_DEFINITIONS: ToolDefinition[] = RAW_TOOLS.map((t) => ({
  ...t,
  inputJsonSchema: z.toJSONSchema(t.inputSchema),
}));
