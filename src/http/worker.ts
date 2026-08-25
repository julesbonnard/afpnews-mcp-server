import { createHttpApp, resolveHttpConfig } from './server.js';

// Cloudflare Worker entry point. Config arrives via the `env` binding
// argument (not `process.env`, which doesn't exist on Workers) — set these
// as plain vars or, for the secrets, via `wrangler secret put`:
//   APICORE_API_KEY, APICORE_BASE_URL, JWT_SECRET, MCP_SERVER_URL,
//   MCP_ALLOWED_REDIRECT_URIS (optional)
// `PORT` is irrelevant here (Workers has no port to bind) and is ignored.
export interface WorkerEnv {
  APICORE_API_KEY?: string;
  APICORE_BASE_URL?: string;
  JWT_SECRET?: string;
  MCP_SERVER_URL?: string;
  MCP_ALLOWED_REDIRECT_URIS?: string;
  // Other bindings (KV, secrets, …) may be present but aren't needed here.
  [key: string]: string | undefined;
}

// Built once per isolate on first request, then reused — deriving the HKDF
// keys is cheap, but there's no reason to redo it on every request within
// the same isolate. A new isolate (cold start, or after a deploy) just
// rebuilds it once.
let appPromise: ReturnType<typeof createHttpApp> | undefined;

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    appPromise ??= createHttpApp(resolveHttpConfig(env));
    const app = await appPromise;
    return app.fetch(request);
  },
};
