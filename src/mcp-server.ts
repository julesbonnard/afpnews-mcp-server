import { McpServer } from "@modelcontextprotocol/server";
import { ApiCore } from "afpnews-api";
import { registerTools } from "./tools/register.js";
import { registerResources } from "./resources/register.js";
import { registerPrompts } from "./prompts/register.js";

import pkg from "../package.json" with { type: "json" };
const { version } = pkg;

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

/** Builds and wires an MCP server around an already-usable ApiCore instance. Use this directly
 * if you manage your own AFP session; createServer() below is for callers who don't. */
export function buildServer(apicore: ApiCore): McpServer {
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

  return buildServer(apicore);
}
