import type { ServerContext } from '../mcp-server.js';
import { RAW_TOOLS } from './index.js';
import { READ_ONLY_ANNOTATIONS } from './shared.js';

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
      async (args: Record<string, unknown>) => (tool.handler as any)(ctx.apicore, args),
    );
  }
}
