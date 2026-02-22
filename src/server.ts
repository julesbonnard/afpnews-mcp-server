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

export interface CreateServerOptions {
  apiKey: string;
  username: string;
  password: string;
  baseUrl?: string;
}

export async function createServer({
  apiKey,
  username,
  password,
  baseUrl,
}: CreateServerOptions): Promise<McpServer> {
  if (!apiKey || !username || !password) {
    throw new Error(
      "Missing authentication configuration. Provide APICORE_API_KEY, APICORE_USERNAME and APICORE_PASSWORD.",
    );
  }

  const apicore = new ApiCore({ ...(baseUrl ? { baseUrl } : {}), apiKey });
  await apicore.authenticate({ username, password });

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
