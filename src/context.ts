import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiCore } from 'afpnews-api';

export interface ServerContext {
  server: McpServer;
  apicore: ApiCore;
  authenticate: () => Promise<void>;
}
