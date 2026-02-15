# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that exposes AFP news tools for LLM-based editors (Continue, Claude Code, etc.). Supports stdio and HTTP (Streamable HTTP) transports.

## Commands

```bash
pnpm install        # Install dependencies
pnpm run build      # Compile TypeScript and make output executable
pnpm run start      # Run the MCP server (stdio transport)
```

## Architecture

TypeScript project organized in `src/`:

```
src/
├── index.ts              # Entry point (stdio & HTTP transports)
├── server.ts             # createServer + ServerContext
├── tools/
│   ├── index.ts          # registerTools() — search, get, mlt, list
│   └── notifications.ts  # registerNotificationTools() — notification center
├── prompts/
│   └── index.ts          # registerPrompts()
├── resources/
│   └── index.ts          # registerResources()
├── utils/
│   ├── format.ts         # formatDocument, GENRE_EXCLUSIONS, DEFAULT_FIELDS
│   ├── helpers.ts        # searchAndFormat
│   ├── types.ts          # AFPDocument, FormattedContent
│   └── topics.ts         # TOPICS, getTopicLabel, formatTopicList
└── __tests__/
```

1. Creates an `ApiCore` client from `afpnews-api` using `APICORE_API_KEY`
2. Registers MCP tools via `@modelcontextprotocol/sdk`: `search`, `get`, `mlt`, `list`, and 5 notification tools
3. Authenticates with username/password on first call, then reuse or refresh token for every following queries
4. Supports two transports: stdio (default) and HTTP (`MCP_TRANSPORT=http`, uses Express + Streamable HTTP with Basic Auth per-session)

## Environment Variables

Required in `.env` (loaded by dotenv):
- `APICORE_API_KEY` — AFP API key
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

## Outils MCP disponibles

| Outil    | Description                                                        |
|----------|--------------------------------------------------------------------|
| `search` | Outil principal de recherche d'articles (filtres + presets + mode fullText) |
| `get`    | Récupération d'un article complet par UNO (texte non tronqué)      |
| `mlt`    | Articles similaires (More Like This) à partir d'un UNO             |
| `list`   | Liste des valeurs d'une facette (slug, genre, country) avec fréquence (preset disponible) |
| `notification-register-service` | Enregistrer un service de notification (mail, rest, sqs, jms) |
| `notification-list-services` | Lister les services de notification enregistrés |
| `notification-add-subscription` | Ajouter une souscription à un service (filtres: query, lang, product, country, slug) |
| `notification-list-subscriptions` | Lister les souscriptions (toutes ou par service) |
| `notification-delete-subscription` | Supprimer une souscription d'un service |

### Presets

#### `search.preset`

Presets disponibles:
- `a-la-une`
- `agenda`
- `previsions`
- `major-stories`

Comportement:
- Chaque preset applique automatiquement un jeu de filtres `search` adapté.
- Le preset peut être affiné via les autres paramètres (`lang`, `size`, etc.), selon les champs déjà fixés par le preset.

#### `list.preset`

Preset disponible:
- `trending-topics` (équivalent de la logique “topics tendance”)

Comportement:
- Si `preset=trending-topics`, `facet` est ignoré et remplacé en interne par `slug`.
- Sans preset, `facet` est requis.

### Paramètre `fullText` (tool `search`)

- Type: `boolean`
- Défaut global: `false`
- Overridé par certains presets

Règles:
- `fullText=false` -> extrait (premiers paragraphes)
- `fullText=true` -> texte complet de la dépêche

## Roadmap — Améliorations fonctionnelles

Pas d'améliorations en attente.
