import { describe, expect, it } from 'bun:test';
import worker, { type WorkerEnv } from '../http/worker.js';

const VALID_ENV: WorkerEnv = {
  APICORE_API_KEY: 'test-key',
  APICORE_BASE_URL: 'https://fake.api.afp.com',
  JWT_SECRET: 'a-very-long-test-secret-of-32-chars-min',
  MCP_SERVER_URL: 'https://worker-a.example.com',
};

// worker.ts's `fetch` reaches Hono's own app.fetch() in-process (no real port, unlike
// startHttpServer()), so these tests run against the exported handler directly.
//
// worker.ts memoizes the built app in a module-level `appPromise`, built once per isolate from
// the FIRST request's env — so test order matters here: the "missing env" case must run before
// any successful call, otherwise the already-built app from a prior test would just be reused
// and the invalid env would never actually be evaluated.
describe('Cloudflare Worker entry point', () => {
  it('rejects when required env vars are missing (must run before any successful call below)', async () => {
    await expect(worker.fetch(new Request('http://worker/health'), {})).rejects.toThrow(
      'APICORE_API_KEY environment variable is required',
    );
  });

  it('builds the app from env and serves a request', async () => {
    const res = await worker.fetch(new Request('http://worker/health'), VALID_ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('memoizes the app across calls: a later call with a different env still serves the first config', async () => {
    const otherEnv: WorkerEnv = { ...VALID_ENV, MCP_SERVER_URL: 'https://worker-b.example.com' };
    const res = await worker.fetch(new Request('http://worker/.well-known/oauth-protected-resource/mcp'), otherEnv);
    expect(res.status).toBe(200);
    // Reflects VALID_ENV (worker-a), not otherEnv (worker-b) — proving the app built on the
    // first successful call above was reused rather than rebuilt from this call's env.
    expect((await res.json()).resource).toBe('https://worker-a.example.com/mcp');
  });
});
