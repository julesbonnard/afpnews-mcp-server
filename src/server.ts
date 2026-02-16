import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiCore, type AuthToken } from "afpnews-api";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

export interface ServerContext {
  server: McpServer;
  apicore: ApiCore;
}

function isAuthToken(value: unknown): value is AuthToken {
  if (!value || typeof value !== "object") {
    return false;
  }

  const token = value as Partial<AuthToken>;
  return (
    typeof token.accessToken === "string" &&
    typeof token.refreshToken === "string" &&
    typeof token.tokenExpires === "number" &&
    (token.authType === "anonymous" || token.authType === "credentials")
  );
}

export async function createServer(
  apiKey: string,
  username: string,
  password: string,
): Promise<McpServer>;
export async function createServer(token: AuthToken): Promise<McpServer>;
export async function createServer(
  apiKeyOrToken: string | AuthToken,
  username?: string,
  password?: string,
): Promise<McpServer> {
  let apicore: ApiCore;

  if (isAuthToken(apiKeyOrToken)) {
    apicore = new ApiCore();
    apicore.token = apiKeyOrToken;
  } else {
    if (!apiKeyOrToken || !username || !password) {
      throw new Error(
        "Missing authentication configuration. Provide either an AuthToken or APICORE_API_KEY, APICORE_USERNAME and APICORE_PASSWORD.",
      );
    }
    apicore = new ApiCore({ apiKey: apiKeyOrToken });
    await apicore.authenticate({ username, password });
  }

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
