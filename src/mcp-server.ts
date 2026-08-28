import { McpServer } from "@modelcontextprotocol/server";
import { ApiCore } from "afpnews-api";
import { registerTools } from "./tools/register.js";
import { registerResources } from "./resources/register.js";
import { registerPrompts } from "./prompts/register.js";
// Static JSON import instead of createRequire(import.meta.url)('../package.json'):
// createRequire is Node/Bun-specific and reads from a real filesystem at
// runtime, which a Cloudflare Worker bundle doesn't have. Default import
// only: esbuild (Wrangler's bundler) doesn't support named exports from a
// JSON module, even though Bun does.
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
