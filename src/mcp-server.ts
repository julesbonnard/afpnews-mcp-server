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

/** Builds and wires an MCP server around an already-usable ApiCore instance — the part shared
 * by createServer() (owns its own auth) and createServerFromApicore() (reuses the caller's). */
function buildServer(apicore: ApiCore): McpServer {
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

/**
 * Builds an MCP server around an ApiCore instance the caller already authenticated and manages
 * itself — for a consumer with its own AFP session (e.g. afpnews-deck) that wants the real MCP
 * protocol, including its input validation, via an in-process transport (e.g. the SDK's
 * InMemoryTransport) rather than calling ToolDefinition.handler directly and re-authenticating.
 */
export function createServerFromApicore(apicore: ApiCore): McpServer {
  return buildServer(apicore);
}
