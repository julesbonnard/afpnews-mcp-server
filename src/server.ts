import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiCore } from "afpnews-api";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

export interface ServerContext {
  server: McpServer;
  apicore: ApiCore;
}

export async function createServer(
  apiKey: string,
  username: string,
  password: string,
): Promise<McpServer>;
export async function createServer(
  apiKey: string,
  username?: string,
  password?: string,
): Promise<McpServer> {
  if (!apiKey || !username || !password) {
    throw new Error(
      "Missing authentication configuration. Provide APICORE_API_KEY, APICORE_USERNAME and APICORE_PASSWORD.",
    );
  }

  const apicore = new ApiCore({ apiKey });
  await apicore.authenticate({ username, password });

  const server = new McpServer({
    name: "afpnews",
    version: "1.2.0",
  });

  const ctx = { server, apicore };

  registerTools(ctx);
  registerResources(ctx);
  registerPrompts(ctx);

  return server;
}
