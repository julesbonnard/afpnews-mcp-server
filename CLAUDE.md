# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that exposes AFP news tools for LLM-based editors (Continue, Claude Code, etc.). Supports stdio and HTTP (Streamable HTTP) transports.

## Commands

```bash
bun install         # Install dependencies
bun src/index.ts    # Run the MCP server (stdio transport by default)
bun test            # Run tests
```

## Architecture

TypeScript project organized in `src/`:

```
src/
├── index.ts              # Entry point — dispatches to stdio or HTTP transport
├── mcp-server.ts         # createServer + ServerContext
├── definitions.ts        # Server-agnostic exports (tools/prompts/resources)
├── tools/
│   ├── index.ts          # registerTools() MCP glue
│   ├── shared.ts         # Shared enums/constants/helpers
│   ├── search-articles.ts
│   ├── get-article.ts
│   ├── find-similar.ts
│   ├── list-facets.ts
│   ├── search-media.ts
│   └── get-media.ts
├── prompts/
│   ├── index.ts          # registerPrompts() MCP glue
│   ├── daily-briefing.ts
│   ├── comprehensive-analysis.ts
│   ├── factcheck.ts
│   └── country-news.ts
├── resources/
│   ├── index.ts          # registerResources() MCP glue
│   └── topics.ts         # TOPICS inline + resource handler
├── http/
│   ├── server.ts         # Elysia HTTP server + OAuth2 PKCE auth
│   ├── tokens.ts         # JWT helpers (encrypt/decrypt AFP tokens)
│   └── login-page.ts     # OAuth login page + redirect URI helpers
├── stdio/
│   └── server.ts         # stdio transport entry
└── utils/
    ├── format.ts         # formatDocument, textContent, toolError, truncateIfNeeded, buildPaginationLine
    ├── format-media.ts   # extractRenditions, formatMediaDocument
    └── types.ts          # AFPDocument, TextContent, FormattedContent, constants
```

1. Creates an `ApiCore` client from `afpnews-api` using `APICORE_API_KEY`
2. Registers MCP tools via `@modelcontextprotocol/sdk`: `afp_search_articles`, `afp_get_article`, `afp_find_similar`, `afp_list_facets`, `afp_search_media`, `afp_get_media`
3. Authenticates with username/password on first call, then reuses or refreshes the token for subsequent queries
4. Supports two transports: stdio (default) and HTTP (`MCP_TRANSPORT=http`, uses Elysia + Streamable HTTP with OAuth2 PKCE per-session)

### Definitions-First Pattern

- Tool/prompt/resource files are server-agnostic definitions only.
- MCP-specific glue (`server.registerTool`, `server.registerPrompt`, `server.registerResource`) lives only in each domain `index.ts`.
- Aggregated non-MCP exports are provided in `src/definitions.ts`.
- Published subpath export: `afpnews-mcp-server/definitions`.

## Environment Variables

### Stdio mode

Required:
- `APICORE_API_KEY` — AFP API key
- `APICORE_USERNAME` — AFP account username
- `APICORE_PASSWORD` — AFP account password

Optional:
- `APICORE_BASE_URL` — AFP API base URL (overrides SDK default)

### HTTP mode

Required:
- `APICORE_API_KEY` — AFP API key
- `APICORE_BASE_URL` — AFP API base URL
- `JWT_SECRET` — Secret for JWT signing/encryption (min 32 characters)
- `MCP_SERVER_URL` — Public URL of the server (e.g. `https://news-mcp.example.com`)
- `MCP_TRANSPORT=http`

Optional:
- `PORT` — HTTP server port (default: 3000)
- `MCP_SESSION_TTL` — Session duration in milliseconds (default: 3600000 = 1h)
- `MCP_ALLOWED_REDIRECT_URIS` — Comma-separated list of allowed OAuth redirect URIs

## Key Details

- **Package manager**: bun (v1.3.10)
- **Runtime**: Bun — TypeScript executed directly, no build step
- **Module system**: ESM (`"type": "module"`)
- **Tests**: `bun test`
- Document types from `afpnews-api` are untyped — the code uses `(doc as any)` casts
- Package exports:
  - `afpnews-mcp-server` → MCP runtime entry (`src/index.ts`)
  - `afpnews-mcp-server/definitions` → pure definitions (`src/definitions.ts`)

## Outils MCP disponibles

| Outil                  | Description                                                        |
|------------------------|--------------------------------------------------------------------|
| `afp_search_articles`  | Outil principal de recherche d'articles (filtres + presets + mode fullText) |
| `afp_get_article`      | Récupération d'un article complet par UNO (texte non tronqué)      |
| `afp_find_similar`     | Articles similaires (More Like This) à partir d'un UNO             |
| `afp_list_facets`      | Liste des valeurs d'une facette (slug, genre, country) avec fréquence (preset disponible) |
| `afp_search_media`     | Recherche de médias AFP (photos, vidéos, graphiques)               |
| `afp_get_media`        | Récupération d'un média complet par UNO, avec embed base64 optionnel |

### Presets

#### `afp_search_articles.preset`

Presets disponibles:
- `a-la-une`
- `agenda`
- `previsions`
- `major-stories`

Comportement:
- Chaque preset applique automatiquement un jeu de filtres `afp_search_articles` adapté.
- Le preset force `fullText=true`.
- Le preset peut être affiné via les autres paramètres (`lang`, `size`, etc.), selon les champs déjà fixés par le preset.

#### `afp_list_facets.preset`

Preset disponible:
- `trending-topics` (équivalent de la logique "topics tendance")

Comportement:
- Si `preset=trending-topics`, `facet` est ignoré et remplacé en interne par `slug`.
- Sans preset, `facet` est requis.

### Paramètre `fullText` (tool `afp_search_articles`)

- Type: `boolean`
- Défaut global: `false`
- Overridé à `true` par les presets

Règles:
- `fullText=false` -> extrait (premiers paragraphes)
- `fullText=true` -> texte complet de la dépêche

## Roadmap — Améliorations fonctionnelles

### Priorité basse

- **Notifications / veille** — exploiter le Notification Center de l'API (`registerService`, `addSubscription`) pour créer des alertes par webhook ou email (bloqué : l'API côté serveur ne fonctionne pas actuellement)
