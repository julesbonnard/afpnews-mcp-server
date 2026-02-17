import { z } from 'zod';
import type { ServerContext } from '../server.js';
import { afpSearchArticlesTool } from './search-articles.js';
import { afpGetArticleTool } from './get-article.js';
import { afpFindSimilarTool } from './find-similar.js';
import { afpListFacetsTool } from './list-facets.js';
import { READ_ONLY_ANNOTATIONS } from './shared.js';

const RAW_TOOLS = [
  afpSearchArticlesTool,
  afpGetArticleTool,
  afpFindSimilarTool,
  afpListFacetsTool,
] as const;

export const TOOL_DEFINITIONS = RAW_TOOLS.map((t) => ({
  ...t,
  inputJsonSchema: z.toJSONSchema(t.inputSchema),
}));

export function registerTools(ctx: ServerContext) {
  for (const tool of RAW_TOOLS) {
    ctx.server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: READ_ONLY_ANNOTATIONS,
      },
      async (args: Record<string, unknown>) => tool.handler(ctx.apicore, args),
    );
  }
}
