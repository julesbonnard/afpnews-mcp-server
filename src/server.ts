import { createRequire } from 'node:module';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiCore } from "afpnews-api";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export interface ServerContext {
  server: McpServer;
  apicore: ApiCore;
}

export interface AfpAuthToken {
  accessToken: string;
  refreshToken: string;
  tokenExpires: number;
}

export interface CreateServerOptions {
  apiKey: string;
  username?: string;
  password?: string;
  authToken?: AfpAuthToken;
  baseUrl?: string;
}

export async function createServer({
  apiKey,
  username,
  password,
  authToken,
  baseUrl,
}: CreateServerOptions): Promise<McpServer> {
  if (!apiKey) {
    throw new Error('Missing authentication configuration: APICORE_API_KEY is required.');
  }

  const apicore = new ApiCore({ ...(baseUrl ? { baseUrl } : {}), apiKey });

  if (authToken) {
    apicore.token = { ...authToken, authType: 'credentials' };
  } else if (username && password) {
    await apicore.authenticate({ username, password });
  } else {
    throw new Error('Missing authentication: provide either authToken or username+password.');
  }

  const server = new McpServer({
    name: "afpnews",
    version,
  });

  const ctx = { server, apicore };

  registerTools(ctx);
  registerResources(ctx);
  registerPrompts(ctx);

  return server;
}
