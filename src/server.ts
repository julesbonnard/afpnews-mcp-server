import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiCore } from 'afpnews-api';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

export function createServer(apiKey: string, username: string, password: string): McpServer {
  const apicore = new ApiCore({ apiKey });

  async function authenticate() {
    if (apicore.isTokenValid) return;
    await apicore.authenticate({ username, password });
  }

  const server = new McpServer({
    name: 'afpnews',
    version: '1.0.0',
  });

  const ctx = { server, apicore, authenticate };

  registerTools(ctx);
  registerResources(ctx);
  registerPrompts(ctx);

  return server;
}
