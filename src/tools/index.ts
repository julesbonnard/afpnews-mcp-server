import type { ServerContext } from '../server.js';
import { afpSearchArticlesTool } from './search-articles.js';
import { afpGetArticleTool } from './get-article.js';
import { afpFindSimilarTool } from './find-similar.js';
import { afpListFacetsTool } from './list-facets.js';
import { READ_ONLY_ANNOTATIONS } from './shared.js';

export const TOOL_DEFINITIONS = [
  afpSearchArticlesTool,
  afpGetArticleTool,
  afpFindSimilarTool,
  afpListFacetsTool,
] as const;

export function registerTools(ctx: ServerContext) {
  for (const tool of TOOL_DEFINITIONS) {
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
