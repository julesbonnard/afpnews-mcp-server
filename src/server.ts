import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiCore } from 'afpnews-api';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

export async function createServer(apiKey: string, username: string, password: string): Promise<McpServer> {
  const apicore = new ApiCore({ apiKey });
  await apicore.authenticate({ username, password });

  const server = new McpServer({
    name: 'afpnews',
    version: '1.0.0',
  });

  const ctx = { server, apicore };

  registerTools(ctx);
  registerResources(ctx);
  registerPrompts(ctx);

  return server;
}
