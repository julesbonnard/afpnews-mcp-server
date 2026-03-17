# Migration Bun + Elysia — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate afpnews-mcp-server from Node.js/pnpm/Express/vitest to Bun/Elysia/bun:test, keeping the npm `definitions` subpath compatible with Node.js/Vite.

**Architecture:** Bun replaces Node.js for all runtimes (dev, Docker, stdio). Elysia + `@elysiajs/node` replaces Express — the node adapter exposes `context.node.req`/`context.node.res` for the `/mcp` route which requires Node.js `IncomingMessage`/`ServerResponse`. `tsc` is preserved only for npm publication (`.d.ts` generation).

**Tech Stack:** Bun 1.x, Elysia 1.x, @elysiajs/node, @elysiajs/rate-limit, TypeScript 5.x (tsc — npm only), jose 6.x, @modelcontextprotocol/sdk 1.26+

**Spec:** `docs/superpowers/specs/2026-03-17-bun-elysia-migration-design.md`

---

## File Map

| File | Change |
|---|---|
| `package.json` | deps, scripts, packageManager |
| `src/index.ts` | full rewrite of HTTP server (Express → Elysia) + `import.meta.main` |
| `src/__tests__/format.test.ts` | `vitest` → `bun:test` import |
| `src/__tests__/index-auth.test.ts` | `vitest` → `bun:test` import |
| `src/__tests__/server.test.ts` | `vi.fn()` → `mock()`, `vi.mock()` → `mock.module()` |
| `src/__tests__/create-server.test.ts` | `vi.hoisted()` + `vi.mock()` → `mock.module()` restructure |
| `Dockerfile` | single-stage Bun, no tsc build step |
| `vitest.config.ts` | deleted |
| `pnpm-lock.yaml` | deleted → `bun.lock` generated |
| `.gitignore` | `bun.lock` entry if absent |

**Unchanged:** `src/server.ts`, `src/definitions.ts`, `src/tools/`, `src/prompts/`, `src/resources/`, `src/utils/`, `tsconfig.json` (minor), all business logic in `src/index.ts`.

---

## Chunk 1: Tooling — Bun, deps, tests

### Task 1: Install Bun and bootstrap package manager

**Files:**
- Modify: `package.json`
- Delete: `pnpm-lock.yaml`
- Create: `bun.lock` (generated)

- [ ] **Step 1: Verify Bun is installed**

```bash
bun --version
```

Expected: `1.x.x`. If not installed: `curl -fsSL https://bun.sh/install | bash`

- [ ] **Step 2: Update `packageManager` field in `package.json`**

Set the field to the version returned by Step 1. For example if `bun --version` returned `1.2.5`:

Change:
```json
"packageManager": "pnpm@10.29.3"
```
To (substitute your actual version):
```json
"packageManager": "bun@<your-version>"
```

- [ ] **Step 3: Run `bun install` to generate `bun.lock`**

```bash
bun install
```

Expected: creates `bun.lock`, `node_modules/` populated.

- [ ] **Step 4: Delete `pnpm-lock.yaml`**

```bash
rm pnpm-lock.yaml
```

- [ ] **Step 5: Commit `bun.lock` to the repository**

`bun.lock` is the lockfile and should be committed (same as `pnpm-lock.yaml`). Verify it is not in `.gitignore`:

```bash
grep bun.lock .gitignore
```

Expected: no output. If it appears, remove that line from `.gitignore`.

- [ ] **Step 6: Update `package.json` scripts**

Apply all four changes to `package.json`:

```json
"scripts": {
  "clean": "rm -rf build",
  "build": "bun run clean && tsc && chmod 755 build/index.js",
  "prepublishOnly": "bun run build",
  "start": "bun run build/index.js",
  "test": "vitest run"
}
```

(`test` will be updated in Task 6. `start` now uses `bun` instead of `node`.)

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock
git rm pnpm-lock.yaml
git commit -m "chore: migrate package manager from pnpm to bun"
```

---

### Task 2: Remove dotenv dependency

**Files:**
- Modify: `package.json` (remove `dotenv` dep)
- Modify: `src/index.ts` (remove import)

Bun loads `.env` automatically at startup — `dotenv` is redundant.

- [ ] **Step 1: Remove `dotenv` from `package.json` dependencies**

```bash
bun remove dotenv
```

- [ ] **Step 2: Remove the dotenv import from `src/index.ts`**

Delete line 4 of `src/index.ts`:
```typescript
import 'dotenv/config';
```

- [ ] **Step 3: Verify the server still reads `.env`**

```bash
bun run src/index.ts
```

Expected: starts without error (reads `.env` natively). Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add package.json src/index.ts bun.lock
git commit -m "chore: remove dotenv — Bun loads .env natively"
```

---

### Task 3: Migrate `format.test.ts` and `index-auth.test.ts` (trivial)

**Files:**
- Modify: `src/__tests__/format.test.ts`
- Modify: `src/__tests__/index-auth.test.ts`

**Requires:** Task 2 completed (dotenv removed). `index-auth.test.ts` imports from `../index.js` which previously imported `dotenv/config` — if dotenv is removed from `package.json` but the import line remains, the test will fail with a module-not-found error. Task 2 must be complete first.

These files only use `describe`, `it`, `expect` — a one-line import change each.

- [ ] **Step 1: Update `format.test.ts`**

Change:
```typescript
import { describe, it, expect } from 'vitest';
```
To:
```typescript
import { describe, it, expect } from 'bun:test';
```

- [ ] **Step 2: Update `index-auth.test.ts`**

Change:
```typescript
import { describe, expect, it } from 'vitest';
```
To:
```typescript
import { describe, expect, it } from 'bun:test';
```

- [ ] **Step 3: Run these two tests to verify they pass**

```bash
bun test src/__tests__/format.test.ts src/__tests__/index-auth.test.ts
```

Expected: all tests pass.

---

### Task 4: Migrate `server.test.ts` (`vi.fn` → `mock`)

**Files:**
- Modify: `src/__tests__/server.test.ts`

- [ ] **Step 1: Update the import line**

Change:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
```
To:
```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test';
```

- [ ] **Step 2: Replace `vi.fn()` with `mock()` in `createMockApicore`**

Change:
```typescript
function createMockApicore() {
  return {
    search: vi.fn().mockResolvedValue({ documents: makeDocs(3), count: 3 }),
    get: vi.fn().mockResolvedValue(makeDocs(1)[0]),
    mlt: vi.fn().mockResolvedValue({ documents: makeDocs(2), count: 2 }),
    list: vi.fn().mockResolvedValue([{ name: 'economy', count: 42 }]),
  };
}
```
To:
```typescript
function createMockApicore() {
  return {
    search: mock().mockResolvedValue({ documents: makeDocs(3), count: 3 }),
    get: mock().mockResolvedValue(makeDocs(1)[0]),
    mlt: mock().mockResolvedValue({ documents: makeDocs(2), count: 2 }),
    list: mock().mockResolvedValue([{ name: 'economy', count: 42 }]),
  };
}
```

- [ ] **Step 3: Replace `mockResolvedValueOnce` / `mockRejectedValueOnce` call sites**

These methods work identically in bun:test — no change needed beyond the import. Verify by searching:

```bash
grep -n "vi\." src/__tests__/server.test.ts
```

Expected: zero results.

- [ ] **Step 4: Run the test to verify it passes**

```bash
bun test src/__tests__/server.test.ts
```

Expected: all tests pass.

---

### Task 5: Migrate `create-server.test.ts` (`vi.hoisted` → dynamic imports)

**Files:**
- Modify: `src/__tests__/create-server.test.ts`

This is the non-trivial migration. The current test uses `vi.hoisted()` to share mock variables between `vi.mock()` factories and test bodies.

**Important:** In bun:test, `mock.module()` is hoisted at the module level, but static ESM `import` statements are also hoisted at parse time by the JS engine — before any executable code. This means a static `import { createServer } from '../server.js'` will resolve *before* `mock.module('afpnews-api', ...)` has a chance to replace the module. The reliable approach is to use **dynamic imports inside each test** after the `mock.module()` registrations.

- [ ] **Step 1: Rewrite `create-server.test.ts` from scratch**

Replace the entire file content with:

```typescript
import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Define shared mock functions at module scope
const authenticateMock = mock();
const apiCoreInstances: Array<{ token?: unknown; config?: unknown }> = [];
const registerToolsMock = mock();
const registerResourcesMock = mock();
const registerPromptsMock = mock();

// mock.module() is hoisted by bun:test before imports are resolved
mock.module('afpnews-api', () => {
  class MockApiCore {
    token?: unknown;
    config?: unknown;

    constructor(config?: unknown) {
      this.config = config;
      apiCoreInstances.push(this);
    }

    authenticate = authenticateMock;
  }

  return { ApiCore: MockApiCore };
});

mock.module('../tools/index.js', () => ({ registerTools: registerToolsMock }));
mock.module('../resources/index.js', () => ({ registerResources: registerResourcesMock }));
mock.module('../prompts/index.js', () => ({ registerPrompts: registerPromptsMock }));

describe('createServer', () => {
  beforeEach(() => {
    authenticateMock.mockReset();
    authenticateMock.mockResolvedValue(undefined);
    registerToolsMock.mockReset();
    registerResourcesMock.mockReset();
    registerPromptsMock.mockReset();
    apiCoreInstances.length = 0;
  });

  it('authenticates with provided credentials', async () => {
    // Dynamic import ensures mock.module() is active when the module is loaded
    const { createServer } = await import('../server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });

    expect(apiCoreInstances).toHaveLength(1);
    expect(apiCoreInstances[0].config).toEqual({ apiKey: 'api-key' });
    expect(authenticateMock).toHaveBeenCalledWith({ username: 'user', password: 'pass' });
  });

  it('passes baseUrl to ApiCore when provided', async () => {
    const { createServer } = await import('../server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass', baseUrl: 'https://custom.api.com' });

    expect(apiCoreInstances[0].config).toEqual({ apiKey: 'api-key', baseUrl: 'https://custom.api.com' });
  });

  it('does not set baseUrl on ApiCore when omitted', async () => {
    const { createServer } = await import('../server.js');
    await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });

    expect(apiCoreInstances[0].config).not.toHaveProperty('baseUrl');
  });

  it('throws on missing credentials', async () => {
    const { createServer } = await import('../server.js');
    await expect(
      createServer({ apiKey: 'api-key', username: 'user', password: '' }),
    ).rejects.toThrow('Missing authentication');
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
bun test src/__tests__/create-server.test.ts
```

Expected: all 4 tests pass. If `apiCoreInstances` accumulates entries across tests despite `mockReset()`, add `mock.restore()` in `beforeEach` or clear the array manually (already done via `apiCoreInstances.length = 0`).

---

### Task 6: Remove vitest, update test script, run full suite

**Files:**
- Modify: `package.json`
- Delete: `vitest.config.ts`

- [ ] **Step 1: Remove vitest from devDependencies**

```bash
bun remove vitest
```

- [ ] **Step 2: Update the `test` script in `package.json`**

Change:
```json
"test": "vitest run"
```
To:
```json
"test": "bun test"
```

- [ ] **Step 3: Delete `vitest.config.ts`**

```bash
rm vitest.config.ts
```

`bun test` discovers `**/*.test.ts` from the project root by default. The previous vitest config restricted discovery to `src/__tests__/**/*.test.ts` — the scope is identical since no `.test.ts` files exist elsewhere. Verify:

```bash
find . -name "*.test.ts" -not -path "*/node_modules/*"
```

Expected: only files under `src/__tests__/`.

- [ ] **Step 4: Run the full test suite**

```bash
bun test
```

Expected: all tests pass. Fix any remaining `vi.` references if found.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock vitest.config.ts src/__tests__/format.test.ts src/__tests__/index-auth.test.ts src/__tests__/server.test.ts src/__tests__/create-server.test.ts
git rm vitest.config.ts
git commit -m "chore: migrate test runner from vitest to bun test"
```

---

## Chunk 2: HTTP Server — Elysia

### Task 7: Install Elysia, remove Express

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Elysia and adapters**

```bash
bun add elysia @elysiajs/node @elysiajs/rate-limit
```

- [ ] **Step 2: Remove Express packages**

```bash
bun remove express express-rate-limit @types/express
```

- [ ] **Step 3: Verify `package.json` dependencies look correct**

`dependencies` should now contain: `@modelcontextprotocol/sdk`, `afpnews-api`, `elysia`, `@elysiajs/node`, `@elysiajs/rate-limit`, `jose`, `zod`

`devDependencies` should contain: `@types/node`, `typescript`

- [ ] **Step 4: Run existing tests to verify nothing broken**

```bash
bun test
```

Expected: all pass (tests don't depend on Express).

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: replace express with elysia + @elysiajs/node + @elysiajs/rate-limit"
```

---

### Task 8: Rewrite `src/index.ts` — HTTP server (Express → Elysia)

**Files:**
- Modify: `src/index.ts`

This is the main task. Only the `startHttpServer()` function and the entry guard change. All helper functions (`deriveKey`, `encryptAfpToken`, `decryptAfpToken`, `encryptAfpRefreshToken`, `decryptAfpRefreshToken`, `buildLoginPage`, `buildAllowedUris`, `isAllowedRedirectUri`, `resolveStdioAuthConfig`, `startStdioServer`, `main`) are **unchanged**.

#### 8a — Fix the entry guard

- [ ] **Step 1: Replace `import.meta.url` guard with `import.meta.main`**

At the bottom of `src/index.ts`, change:
```typescript
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
  });
}
```
To:
```typescript
if (import.meta.main) {
  main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
  });
}
```

#### 8b — Update imports in `startHttpServer`

- [ ] **Step 2: Replace Express imports with Elysia**

At the top of `src/index.ts`, the dynamic `import('express')` inside `startHttpServer` is replaced by top-level imports. Add to the top of the file:

```typescript
import { Elysia, t } from 'elysia';
import { node } from '@elysiajs/node';
import { rateLimit } from '@elysiajs/rate-limit';
import type { IncomingMessage, ServerResponse } from 'node:http';
```

Remove the line:
```typescript
const { default: express } = await import('express');
```

#### 8c — Rewrite `startHttpServer` with Elysia

- [ ] **Step 3: Replace the entire `startHttpServer` function body**

The function signature stays the same: `async function startHttpServer()`. Replace its body with the following implementation. All business logic (PKCE, JWE, sessions, TTL, authCodes) is identical to the current code — only the HTTP glue changes.

```typescript
async function startHttpServer() {
  const apiKey = process.env.APICORE_API_KEY;
  if (!apiKey) throw new Error('APICORE_API_KEY environment variable is required');

  const afpBaseUrl = process.env.APICORE_BASE_URL?.trim();

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  const serverUrl = process.env.MCP_SERVER_URL?.replace(/\/$/, '');
  if (!serverUrl) {
    throw new Error('MCP_SERVER_URL is required in HTTP mode (e.g. https://news-mcp.jub.cool)');
  }

  const allowedUris = buildAllowedUris();
  console.error(`Allowed redirect URIs: localhost/* + ${allowedUris.filter(u => !u.includes('localhost')).join(', ')}`);

  const accessKey = deriveKey(jwtSecret, 'access-token');
  const refreshKey = deriveKey(jwtSecret, 'refresh-token');

  // Sessions store — identical to current
  type Session = { transport: StreamableHTTPServerTransport; server: McpServer; lastAccessedAt: number; username: string };
  const sessions = new Map<string, Session>();

  setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of sessions) {
      if (now - session.lastAccessedAt > SESSION_TTL_MS) {
        sessions.delete(sid);
        console.error(`Session ${sid} expired`);
      }
    }
  }, 60_000);

  type AuthCode = {
    username: string;
    password: string;
    redirectUri: string;
    codeChallenge: string;
    expiresAt: number;
  };
  const authCodes = new Map<string, AuthCode>();

  setInterval(() => {
    const now = Date.now();
    for (const [code, data] of authCodes) {
      if (now > data.expiresAt) authCodes.delete(code);
    }
  }, 60_000);

  // IP generator for rate limiters — reads X-Forwarded-For from Traefik
  // @elysiajs/rate-limit generator signature: (request: Request, server: Server) => string
  const ipGenerator = (request: Request) =>
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';

  const app = new Elysia({ adapter: node() });
  // Note: verify the Elysia constructor supports { adapter } option for your installed version.
  // If it doesn't compile, use: new Elysia().use(node()) instead.

  // Health check
  app.get('/health', () => ({ status: 'ok' }));

  // OAuth metadata
  app.get('/.well-known/oauth-authorization-server', () => ({
    issuer: serverUrl,
    authorization_endpoint: `${serverUrl}/oauth/authorize`,
    token_endpoint: `${serverUrl}/oauth/token`,
    registration_endpoint: `${serverUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  }));

  // Dynamic client registration — scoped rate limit (20 req/min)
  // Scoped sub-instance ensures the limiter applies only to this route, not globally
  const registerGroup = new Elysia()
    .use(rateLimit({ max: 20, duration: 60_000, generator: ipGenerator }))
    .post(
      '/oauth/register',
      ({ body, set }) => {
        set.status = 201;
        return {
          client_id: serverUrl,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          redirect_uris: body.redirect_uris ?? [],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        };
      },
      { body: t.Object({ redirect_uris: t.Optional(t.Array(t.String())) }) },
    );
  app.use(registerGroup);

  // Authorization endpoint — serve login page
  app.get('/oauth/authorize', ({ query, set }) => {
    const { redirect_uri, code_challenge, state, client_id } = query as Record<string, string>;
    if (!redirect_uri || !code_challenge) {
      set.status = 400;
      return 'Missing required OAuth2 parameters';
    }
    if (!isAllowedRedirectUri(redirect_uri, allowedUris)) {
      set.status = 400;
      return 'Invalid redirect_uri: not in the allowed list';
    }
    set.headers['content-type'] = 'text/html; charset=utf-8';
    set.headers['content-security-policy'] =
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'";
    set.headers['x-frame-options'] = 'DENY';
    set.headers['x-content-type-options'] = 'nosniff';
    return buildLoginPage({ redirectUri: redirect_uri, codeChallenge: code_challenge, state, clientId: client_id });
  });

  // Token endpoint — scoped rate limit (10 req/min) + form-encoded body support
  // RFC 6749 requires token endpoints to accept application/x-www-form-urlencoded.
  // The login page POSTs JSON (grant_type: 'afp_credentials'), but standard OAuth clients
  // (Claude Web authorization_code / refresh_token exchange) send form-encoded bodies.
  // onParse handles form-encoded; Elysia falls back to default JSON parser otherwise.
  // Body size: Elysia has no built-in body size limit — accepted trade-off (was 10kb in Express).
  const tokenGroup = new Elysia()
    .use(rateLimit({ max: 10, duration: 60_000, generator: ipGenerator }))
    .onParse(({ request, contentType }) => {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        return request.text().then(text => Object.fromEntries(new URLSearchParams(text)));
      }
      // undefined → Elysia uses default JSON parser
    })
    .post(
      '/oauth/token',
      async ({ body, set }) => {
      const { grant_type, username, password, redirect_uri, code_challenge, state, code, code_verifier, refresh_token } = body;

      // Grant: AFP login — validate AFP credentials, issue auth code
      if (grant_type === 'afp_credentials') {
        if (!username || !password || !redirect_uri || !code_challenge) {
          set.status = 400;
          return { error: 'invalid_request', error_description: 'Missing required fields' };
        }
        if (!isAllowedRedirectUri(redirect_uri, allowedUris)) {
          set.status = 400;
          return { error: 'invalid_request', error_description: 'Invalid redirect_uri' };
        }
        try {
          const { ApiCore } = await import('afpnews-api');
          const testClient = new ApiCore({ ...(afpBaseUrl ? { baseUrl: afpBaseUrl } : {}), apiKey });
          await testClient.authenticate({ username, password });
        } catch {
          set.status = 401;
          return { error: 'invalid_grant', error_description: 'Identifiants AFP invalides' };
        }
        const authCode = crypto.randomUUID();
        authCodes.set(authCode, {
          username,
          password,
          redirectUri: redirect_uri,
          codeChallenge: code_challenge,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });
        return { code: authCode };
      }

      // Grant: authorization_code — PKCE check, issue AFP-token-based access token
      if (grant_type === 'authorization_code') {
        if (!code || !code_verifier || !redirect_uri) {
          set.status = 400;
          return { error: 'invalid_request', error_description: 'Missing code, code_verifier or redirect_uri' };
        }
        const stored = authCodes.get(code);
        if (!stored || Date.now() > stored.expiresAt) {
          set.status = 400;
          return { error: 'invalid_grant', error_description: 'Auth code expired or not found' };
        }
        const { createHash } = await import('node:crypto');
        const expectedChallenge = createHash('sha256').update(code_verifier).digest('base64url');
        if (expectedChallenge !== stored.codeChallenge) {
          set.status = 400;
          return { error: 'invalid_grant', error_description: 'PKCE verification failed' };
        }
        if (stored.redirectUri !== redirect_uri) {
          set.status = 400;
          return { error: 'invalid_grant', error_description: 'redirect_uri mismatch' };
        }
        authCodes.delete(code);

        let afpToken: AfpAuthToken;
        try {
          const { ApiCore } = await import('afpnews-api');
          const client = new ApiCore({ ...(afpBaseUrl ? { baseUrl: afpBaseUrl } : {}), apiKey });
          afpToken = await client.authenticate({ username: stored.username, password: stored.password });
        } catch {
          set.status = 502;
          return { error: 'server_error', error_description: 'AFP authentication failed' };
        }

        const accessToken = await encryptAfpToken(accessKey, {
          at: afpToken.accessToken,
          rt: afpToken.refreshToken,
          exp: afpToken.tokenExpires,
          u: stored.username,
        });
        const refreshTokenJwe = await encryptAfpRefreshToken(refreshKey, afpToken.refreshToken, stored.username);
        const expiresIn = Math.max(60, Math.floor((afpToken.tokenExpires - Date.now()) / 1000));
        return { access_token: accessToken, token_type: 'bearer', expires_in: expiresIn, refresh_token: refreshTokenJwe };
      }

      // Grant: refresh_token
      if (grant_type === 'refresh_token') {
        if (!refresh_token) {
          set.status = 400;
          return { error: 'invalid_request', error_description: 'Missing refresh_token' };
        }
        let afpRefreshToken: string;
        let username: string;
        try {
          ({ afpRefreshToken, username } = await decryptAfpRefreshToken(refreshKey, refresh_token));
        } catch {
          set.status = 401;
          return { error: 'invalid_grant', error_description: 'Invalid refresh token' };
        }
        try {
          const { ApiCore } = await import('afpnews-api');
          const client = new ApiCore({ ...(afpBaseUrl ? { baseUrl: afpBaseUrl } : {}), apiKey });
          client.token = { accessToken: '', refreshToken: afpRefreshToken, tokenExpires: 0, authType: 'credentials' };
          const newAfpToken: AfpAuthToken = await client.authenticate();
          const accessToken = await encryptAfpToken(accessKey, {
            at: newAfpToken.accessToken,
            rt: newAfpToken.refreshToken,
            exp: newAfpToken.tokenExpires,
            u: username,
          });
          const newRefreshToken = await encryptAfpRefreshToken(refreshKey, newAfpToken.refreshToken, username);
          const expiresIn = Math.max(60, Math.floor((newAfpToken.tokenExpires - Date.now()) / 1000));
          return { access_token: accessToken, token_type: 'bearer', expires_in: expiresIn, refresh_token: newRefreshToken };
        } catch {
          set.status = 401;
          return { error: 'invalid_grant', error_description: 'Refresh token expired, please sign in again' };
        }
      }

      set.status = 400;
      return { error: 'unsupported_grant_type' };
    },
    {
      body: t.Object({
        grant_type: t.String(),
        username: t.Optional(t.String()),
        password: t.Optional(t.String()),
        redirect_uri: t.Optional(t.String()),
        code_challenge: t.Optional(t.String()),
        state: t.Optional(t.String()),
        code: t.Optional(t.String()),
        code_verifier: t.Optional(t.String()),
        refresh_token: t.Optional(t.String()),
      }),
    },
  );
  app.use(tokenGroup);

  // MCP endpoint — GET (SSE stream), POST (initialize/messages), DELETE (session teardown)
  // parse: false — Elysia must not consume the body; the MCP transport reads it directly
  // context.node provides raw Node.js IncomingMessage/ServerResponse via @elysiajs/node
  const mcpHandler = async (ctx: { node: { req: IncomingMessage; res: ServerResponse }; headers: Record<string, string> }) => {
    const { req, res } = ctx.node;
    const authHeader = ctx.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bearer token required' }));
      return;
    }

    const token = authHeader.slice(7);
    let afpPayload: AfpTokenPayload;

    try {
      afpPayload = await decryptAfpToken(accessKey, token);
    } catch {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or expired token' }));
      return;
    }

    const sessionId = ctx.headers['mcp-session-id'];

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (session.username !== afpPayload.u) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token does not match session' }));
        return;
      }
      session.lastAccessedAt = Date.now();
      await session.transport.handleRequest(req, res);
      return;
    }

    if (sessionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    const server = await createServer({
      apiKey,
      authToken: { accessToken: afpPayload.at, refreshToken: afpPayload.rt, tokenExpires: afpPayload.exp },
      baseUrl: afpBaseUrl,
    });
    await server.connect(transport);

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        sessions.delete(sid);
        console.error(`Session ${sid} closed`);
      }
    };

    await transport.handleRequest(req, res);

    const sid = transport.sessionId;
    if (sid) {
      sessions.set(sid, { transport, server, lastAccessedAt: Date.now(), username: afpPayload.u });
      console.error(`Session ${sid} created (user: ${afpPayload.u})`);
    }
  };

  app
    .get('/mcp', mcpHandler, { parse: false })
    .post('/mcp', mcpHandler, { parse: false })
    .delete('/mcp', mcpHandler, { parse: false });

  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, () => {
    console.error(`MCP HTTP server listening on port ${port}`);
  });
}
```

**Implementation notes:**
- `ctx.node.req` / `ctx.node.res` — typed as `IncomingMessage`/`ServerResponse` from `node:http`. Provided by `@elysiajs/node`. If the type doesn't match the actual API, check the installed package's exported `NodeContext` type and adjust.
- `parse: false` on `/mcp` routes — prevents Elysia from consuming the request body before the MCP transport reads it.
- The `mcpHandler` writes directly to `res` (Node.js `ServerResponse`) — Elysia won't send a second response because the node adapter checks `res.writableEnded`.
- `ipGenerator` signature: `(request: Request) => string` — matches `@elysiajs/rate-limit` v2.x API. Adjust if your version differs.
- Rate limiter scoping: each limiter is a separate `new Elysia()` sub-instance, then mounted via `app.use()`. This is the correct pattern to scope the limiter to only those routes, not globally.
- `onParse` in `tokenGroup`: handles both `application/x-www-form-urlencoded` (standard OAuth clients) and JSON (login page). Returning `undefined` falls back to Elysia's default JSON parser.

- [ ] **Step 4: Run TypeScript type-check**

```bash
bunx tsc --noEmit
```

Expected: no errors. Fix any type errors (likely in the `mcpHandler` `ctx` typing or `ipGenerator` signature).

- [ ] **Step 5: Run existing tests to verify nothing broken**

```bash
bun test
```

Expected: all pass (tests don't cover the HTTP server directly).

- [ ] **Step 6: Smoke test stdio mode — verify startup and `createRequire` JSON loading**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | bun run src/index.ts
```

Expected: JSON response where:
- `result.serverInfo.name === "afpnews"`
- `result.serverInfo.version` is a valid semver string (e.g. `"1.3.11"`) — **not `undefined` or `"0.0.0"`**

`src/server.ts` uses `createRequire(import.meta.url)('../package.json')` to read the version. If `version` is undefined, Bun's `createRequire` JSON resolution is failing — fix by replacing that line with a direct JSON import:

```typescript
// Alternative if createRequire fails:
import pkg from '../package.json' with { type: 'json' };
const { version } = pkg;
```

- [ ] **Step 7: Smoke test HTTP server**

Start the server in HTTP mode with minimal env vars:

```bash
APICORE_API_KEY=test JWT_SECRET=test-secret-min-32-chars-long-here MCP_SERVER_URL=http://localhost:3000 PORT=3000 bun run src/index.ts &
sleep 1
curl -s http://localhost:3000/health
curl -s http://localhost:3000/.well-known/oauth-authorization-server | head -c 100
kill %1
```

Expected: `{"status":"ok"}` from `/health`. JSON object from `/.well-known/`. If the server crashes on startup, check the `Elysia({ adapter: node() })` constructor syntax against your installed version.

- [ ] **Step 8: Commit**

```bash
git add src/index.ts
git commit -m "feat: replace Express with Elysia + @elysiajs/node for HTTP server"
```

---

## Chunk 3: Dockerfile + npm build validation

### Task 9: Update Dockerfile

**Files:**
- Modify: `Dockerfile`

Current Dockerfile is a multi-stage build (builder + runtime). The new one is a single-stage Bun image that runs TypeScript directly — no `tsc` compilation needed.

- [ ] **Step 1: Replace `Dockerfile` content**

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src/ ./src/
COPY tsconfig.json ./

# Ensure the bun user can read all installed files
RUN chown -R bun:bun /app

USER bun

ENV MCP_TRANSPORT=http
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
```

**Key differences from current:**
- Single stage (no builder)
- `FROM oven/bun:1` instead of `node:22-alpine`
- `bun install` instead of `pnpm install`
- No `RUN bun run build` — Bun executes TS directly
- `USER bun` — non-root user included in the official Bun image
- `COPY tsconfig.json ./` — needed by Bun to resolve TypeScript settings

- [ ] **Step 2: Build the Docker image locally**

```bash
docker build -t afpnews-mcp-server:test .
```

Expected: build succeeds.

- [ ] **Step 3: Run a health check against the container**

```bash
docker run --rm --name afpnews-test -e APICORE_API_KEY=test -e JWT_SECRET=test-secret-minimum-32-chars-long -e MCP_SERVER_URL=http://localhost:3000 -p 3001:3000 -d afpnews-mcp-server:test
sleep 2
curl -s http://localhost:3001/health
docker stop afpnews-test
```

Expected: `{"status":"ok"}` from curl. `docker stop` removes the container (combined with `--rm`).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "chore: replace multi-stage Node.js Dockerfile with single-stage Bun image"
```

---

### Task 10: Verify npm build still works

**Files:** none (read-only validation)

The `definitions` subpath export used by the Vue.js/Vite project must still compile correctly with `tsc`. Note: the current `tsconfig.json` does not include `"declaration": true`, so `.d.ts` files are not generated — this is the pre-existing state, not introduced by this migration.

- [ ] **Step 1: Run the npm build**

```bash
bun run build
```

Expected: `build/` directory populated with `.js` files, no TypeScript errors. Exit code 0.

- [ ] **Step 2: Verify the `definitions` subpath output exists**

```bash
ls build/definitions.js
```

Expected: file exists.

- [ ] **Step 3: Run tests one final time**

```bash
bun test
```

Expected: all pass.

- [ ] **Step 4: Commit only if files changed**

If all prior tasks were committed correctly, there should be nothing left to commit. Verify:

```bash
git status
```

Expected: clean working tree. If there are uncommitted changes (e.g. `tsconfig.json` was updated), commit them explicitly:

```bash
git add tsconfig.json  # or whatever changed
git commit -m "chore: finalize Bun migration"
```

---

## Troubleshooting

### `context.node` is undefined in mcpHandler

If `@elysiajs/node` doesn't inject `node.req`/`node.res` as expected, check the installed version's API. Alternative: access the raw request via `ctx.server.requestEvent` (Bun-specific) or use `ctx.request` (Web API `Request`) to reconstruct the needed headers manually. If the transport strictly requires Node.js `IncomingMessage`, a fallback is to handle `/mcp` via a plain `node:http` handler mounted alongside Elysia.

### `mock.module()` hoisting doesn't work in `create-server.test.ts`

If mocks aren't applied when `createServer` is imported, try moving the `import { createServer }` line to the top and using a dynamic import inside each test:

```typescript
it('authenticates with provided credentials', async () => {
  const { createServer } = await import('../server.js');
  await createServer({ apiKey: 'api-key', username: 'user', password: 'pass' });
  ...
});
```

### TypeScript errors on `ipGenerator` signature

Check the `@elysiajs/rate-limit` package's exported types. The generator may accept `Context` instead of `{ request: Request }`. Adjust the type to match:

```typescript
import type { Context } from 'elysia';
const ipGenerator = (ctx: Context) =>
  ctx.request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
```

### Docker: `USER bun` permission errors

If `bun install` creates files owned by root and `USER bun` can't read them, switch to:

```dockerfile
RUN chown -R bun:bun /app
USER bun
```
Or install as root and change user before CMD only.
