# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that exposes AFP news tools for LLM-based editors (Continue, Claude Code, etc.). Supports stdio and HTTP (Streamable HTTP) transports.

## Commands

```bash
pnpm install        # Install dependencies
pnpm run build      # Compile TypeScript and make output executable
pnpm run start      # Run the MCP server (stdio transport by default)
```

## Architecture

TypeScript project organized in `src/`:

```
src/
├── index.ts              # Entry point (stdio & HTTP transports)
├── server.ts             # createServer + ServerContext
├── definitions.ts        # Server-agnostic exports (tools/prompts/resources)
├── tools/
│   ├── index.ts          # registerTools() MCP glue
│   ├── shared.ts         # Shared enums/constants/helpers
│   ├── search-articles.ts
│   ├── get-article.ts
│   ├── find-similar.ts
│   └── list-facets.ts
├── prompts/
│   ├── index.ts          # registerPrompts() MCP glue
│   ├── daily-briefing.ts
│   ├── comprehensive-analysis.ts
│   ├── factcheck.ts
│   └── country-news.ts
├── resources/
│   ├── index.ts          # registerResources() MCP glue
│   └── topics.ts
├── utils/
│   ├── format.ts         # formatDocument, textContent, toolError, truncateIfNeeded, buildPaginationLine
│   ├── types.ts          # AFPDocument, TextContent, FormattedContent, constants
│   └── topics.ts         # TOPICS, getTopicLabel, formatTopicList
└── __tests__/
```

1. Creates an `ApiCore` client from `afpnews-api` using `APICORE_API_KEY`
2. Registers MCP tools via `@modelcontextprotocol/sdk`: `afp_search_articles`, `afp_get_article`, `afp_find_similar`, `afp_list_facets`
3. Authenticates with username/password on first call, then reuse or refresh token for every following queries
4. Supports two transports: stdio (default) and HTTP (`MCP_TRANSPORT=http`, uses Express + Streamable HTTP with Basic Auth per-session)

### Definitions-First Pattern

- Tool/prompt/resource files are server-agnostic definitions only.
- MCP-specific glue (`server.registerTool`, `server.registerPrompt`, `server.registerResource`) lives only in each domain `index.ts`.
- Aggregated non-MCP exports are provided in `src/definitions.ts`.
- Published subpath export: `afpnews-mcp-server/definitions`.

## Environment Variables

Required in `.env` (loaded by dotenv):
- `APICORE_API_KEY` — AFP API key
- `APICORE_BASE_URL` — AFP API base URL (optional, overrides default)
- `APICORE_USERNAME` — AFP account username (stdio mode only)
- `APICORE_PASSWORD` — AFP account password (stdio mode only)
- `MCP_TRANSPORT` — `http` to start the HTTP server (default: stdio)
- `PORT` — HTTP server port (default: 3000, HTTP mode only)

## Key Details

- **Package manager**: pnpm (v10.29.3)
- **Module system**: ESM (`"type": "module"`)
- **TypeScript target**: ES2022, Node16 module resolution, strict mode
- **Build output**: `build/` directory
- **Tests**: vitest (`pnpm test`)
- Document types from `afpnews-api` are untyped — the code uses `(doc as any)` casts
- Package exports:
  - `afpnews-mcp-server` -> MCP runtime entry (`build/index.js`)
  - `afpnews-mcp-server/definitions` -> pure definitions (`build/definitions.js`)

## Outils MCP disponibles

| Outil                  | Description                                                        |
|------------------------|--------------------------------------------------------------------|
| `afp_search_articles`  | Outil principal de recherche d'articles (filtres + presets + mode fullText) |
| `afp_get_article`      | Récupération d'un article complet par UNO (texte non tronqué)      |
| `afp_find_similar`     | Articles similaires (More Like This) à partir d'un UNO             |
| `afp_list_facets`      | Liste des valeurs d'une facette (slug, genre, country) avec fréquence (preset disponible) |

### Presets

#### `afp_search_articles.preset`

Presets disponibles:
- `a-la-une`
- `agenda`
- `previsions`
- `major-stories`

Comportement:
- Chaque preset applique automatiquement un jeu de filtres `afp_search_articles` adapté.
- Le preset peut être affiné via les autres paramètres (`lang`, `size`, etc.), selon les champs déjà fixés par le preset.

#### `afp_list_facets.preset`

Preset disponible:
- `trending-topics` (équivalent de la logique “topics tendance”)

Comportement:
- Si `preset=trending-topics`, `facet` est ignoré et remplacé en interne par `slug`.
- Sans preset, `facet` est requis.

### Paramètre `fullText` (tool `afp_search_articles`)

- Type: `boolean`
- Défaut global: `false`
- Overridé par certains presets

Règles:
- `fullText=false` -> extrait (premiers paragraphes)
- `fullText=true` -> texte complet de la dépêche

## Roadmap — Améliorations fonctionnelles

### Priorité basse

- **Notifications / veille** — exploiter le Notification Center de l'API (`registerService`, `addSubscription`) pour créer des alertes par webhook ou email (bloqué : l'API côté serveur ne fonctionne pas actuellement)
