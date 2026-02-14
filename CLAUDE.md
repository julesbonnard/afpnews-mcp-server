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

Single-file TypeScript project (`src/index.ts`) that:
1. Creates an `ApiCore` client from `afpnews-api` using `APICORE_API_KEY`
2. Registers four MCP tools via `@modelcontextprotocol/sdk`: `search`, `get`, `mlt`, `list`
3. Authenticates with username/password on each tool call, queries the AFP API
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
- **No tests or linter configured**
- Document types from `afpnews-api` are untyped — the code uses `(doc as any)` casts

## Outils MCP disponibles

| Outil    | Description                                                        |
|----------|--------------------------------------------------------------------|
| `search` | Recherche d'articles avec filtres (langs, dates, country, slug, product, size, sortOrder, offset, includeAgendas) |
| `get`    | Récupération d'un article complet par UNO (texte non tronqué)      |
| `mlt`    | Articles similaires (More Like This) à partir d'un UNO             |
| `list`   | Liste des valeurs d'une facette (slug, genre, country) avec fréquence |

## MCP Resources

| URI              | Description                                      |
|------------------|--------------------------------------------------|
| `afp://breaking` | 10 dernières dépêches AFP (news, tri par date)   |
| `afp://topics`   | 20 sujets tendance (slugs les plus fréquents)    |

## MCP Prompts

| Prompt            | Arguments             | Description                                           |
|-------------------|-----------------------|-------------------------------------------------------|
| `daily-briefing`  | `lang?`               | Briefing quotidien de l'actualité                     |
| `topic-deep-dive` | `topic`, `lang?`      | Analyse approfondie d'un sujet (search + get + mlt)   |
| `country-news`    | `country`, `lang?`    | Résumé de l'actualité d'un pays                       |

## Roadmap — Améliorations fonctionnelles

### Priorité basse

- **Notifications / veille** — exploiter le Notification Center de l'API (`registerService`, `addSubscription`) pour créer des alertes par webhook ou email
