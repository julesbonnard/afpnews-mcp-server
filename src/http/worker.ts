import { createHttpApp, resolveHttpConfig } from './server.js';

export interface WorkerEnv {
  APICORE_API_KEY?: string;
  APICORE_BASE_URL?: string;
  JWT_SECRET?: string;
  MCP_SERVER_URL?: string;
  MCP_ALLOWED_REDIRECT_URIS?: string;
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
