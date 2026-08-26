# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/).

## [3.0.0] — 2026-08-25

### Breaking

- **HTTP transport is now stateless.** The previous session-map model
  (`mcp-session-id`, `MCP_SESSION_TTL`) is gone — every request now gets a
  fresh `McpServer` built straight from its own bearer token, so any number
  of instances can sit behind a plain load balancer with no sticky sessions.
  Deployments that relied on `MCP_SESSION_TTL` or session affinity need to
  drop that configuration.
- Migrated from `@modelcontextprotocol/sdk` (v1) to the split v2 packages
  (`@modelcontextprotocol/server`, `@modelcontextprotocol/hono`), targeting
  the 2026-07-28 MCP spec.
- HTTP framework: **Elysia → Hono**. Framework-specific behavior (error
  response shapes in particular) changed accordingly.
- `/oauth/token` now only accepts `application/x-www-form-urlencoded`
  request bodies (RFC 6749 §4.1.3), not JSON.
- Access tokens are now bound to this server's own `/mcp` resource via an
  `aud` claim (RFC 8707); tokens minted by a different deployment are no
  longer accepted even if it shares the same `JWT_SECRET`.
- 401 responses on `/mcp` now carry a spec-compliant `WWW-Authenticate`
  header pointing at the protected-resource metadata document, replacing
  the previous ad hoc header/body shape.

### Added

- Deployable as a **Cloudflare Worker** (`src/http/worker.ts`, `wrangler.toml`)
  with no KV/Durable Objects/other bindings — the OAuth authorization code
  and bearer tokens are all self-contained.
- `src/http/server.ts` split into `resolveHttpConfig()` / `createHttpApp()` /
  `startHttpServer()`, so the Hono app itself has no Bun or Node dependency.

### Changed

- The OAuth authorization code is now a self-contained token (same JWE
  pattern as the access/refresh tokens) instead of server-side state.
- `node:crypto` dropped in favor of Web Crypto (`crypto.subtle`) for HKDF
  key derivation and the PKCE challenge check — portable across Bun,
  browsers, and Workers.
- Rate limiting (`elysia-rate-limit`) removed; left to the hosting platform
  (e.g. Cloudflare's own Rate Limiting) rather than a hand-rolled,
  per-isolate in-process limiter.
- `/.well-known/oauth-authorization-server` and
  `/.well-known/oauth-protected-resource/mcp` are now served via the SDK's
  own metadata helpers instead of hand-written JSON.

### Fixed

- The JWE's registered `exp` claim was silently overwritten by
  `setExpirationTime()`, so decrypted tokens never carried the real AFP
  token expiry — moved to a dedicated `texp` claim.
- A `globalThis.fetch` mock in `get-media-handler.test.ts` was leaking into
  whichever test file ran next (test-isolation bug).

## [2.2.0] — 2026-08-01

- Snapshot prior to the SDK v2 / Hono / Cloudflare Workers work above.

## [2.0.2] — 2026-06-09

- Fix: `lang` facet examples corrected to `langs` in docs and tests.
- Improved typing, text truncation, and test infrastructure.

## [2.0.0] — 2026-03-17

- Migrated package manager from pnpm to **Bun**; test runner from Vitest to
  `bun test`.
- HTTP transport rewritten on **Elysia** (replacing Express), split into
  `src/http/` submodules; stdio transport extracted to `src/stdio/server.ts`.
- OAuth2/OIDC hardening: AFP refresh token stored in a JWE (no credentials
  persisted server-side), strict `redirect_uri` allowlist, and a round of
  security-audit fixes.
- Added `afp_search_media` / `afp_get_media` tools, with base64 image embed
  for vision models and dedicated media formatting (`format-media.ts`).
- `product` facet replaced with `class` throughout; added `event` field to
  the AFP document model.
- `src/mcp-server.ts` renamed from `server.ts` to avoid a naming collision
  with `http/server.ts`.

## [1.3.10] — 2026-02-22

- `baseUrl` support (`APICORE_BASE_URL`) added and covered by tests.

## [1.3.7] — 2026-02-20

- `afpshortid` field added; `afp_list_facets` fixes.

## [1.3.4] — 2026-02-17

- Tool definitions' JSON Schemas generated via Zod v4's built-in `toJSONSchema`.

## [1.3.2] and earlier

- Initial tool set (search, get article, similar articles, facets),
  prompts (daily briefing, comprehensive analysis, factcheck, country news),
  and the AFP Stories topics resource.
- HTTP transport added alongside stdio; auth token caching.
- Package renamed to `afpnews-mcp-server`; pre-converted JSON Schemas
  exported for cross-instance compatibility.
- A Notification Center implementation was added and then reverted (the
  underlying AFP API endpoint wasn't functional).

[3.0.0]: https://github.com/julesbonnard/afpnews-mcp-server/compare/v2.0.2...v3.0.0
[2.0.2]: https://github.com/julesbonnard/afpnews-mcp-server/compare/v2.0.0...v2.0.2
[2.0.0]: https://github.com/julesbonnard/afpnews-mcp-server/compare/v1.3.10...v2.0.0
[1.3.10]: https://github.com/julesbonnard/afpnews-mcp-server/compare/v1.3.7...v1.3.10
[1.3.7]: https://github.com/julesbonnard/afpnews-mcp-server/compare/v1.3.4...v1.3.7
[1.3.4]: https://github.com/julesbonnard/afpnews-mcp-server/compare/v1.3.2...v1.3.4
