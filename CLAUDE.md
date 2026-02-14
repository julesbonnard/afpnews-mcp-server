# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server that exposes AFP news search as a tool for LLM-based editors (Continue, Claude Code, etc.). Single-tool server communicating over stdio transport.

## Commands

```bash
pnpm install        # Install dependencies
pnpm run build      # Compile TypeScript and make output executable
pnpm run start      # Run the MCP server (stdio transport)
```

## Architecture

Single-file TypeScript project (`src/index.ts`) that:
1. Creates an `ApiCore` client from `afpnews-api` using `APICORE_API_KEY`
2. Registers one MCP tool `"search"` via `@modelcontextprotocol/sdk`
3. On each search call: authenticates with username/password, queries the AFP API with genre exclusions, returns formatted article content (truncated to 10k chars)
4. Connects to stdio transport and listens for MCP requests

## Environment Variables

Required in `.env` (loaded by dotenv):
- `APICORE_API_KEY` — AFP API key
- `APICORE_USERNAME` — AFP account username
- `APICORE_PASSWORD` — AFP account password

## Key Details

- **Package manager**: pnpm (v10.29.3)
- **Module system**: ESM (`"type": "module"`)
- **TypeScript target**: ES2022, Node16 module resolution, strict mode
- **Build output**: `build/` directory
- **No tests or linter configured**
- Document types from `afpnews-api` are untyped — the code uses `(doc as any)` casts

## Roadmap — Améliorations fonctionnelles

### Priorité haute

- **Retourner le `uno` dans les résultats search** — identifiant unique indispensable pour chaîner avec `get` ou `mlt`
- **Outil `get`** — récupérer un article complet par son UNO (`apicore.get(uno)`), le texte search étant tronqué à 10k chars
- **Paramètres `size` et `sortOrder` sur search** — actuellement figés (size=10, tri par date desc). L'API supporte jusqu'à 1 000 résultats et le tri par pertinence

### Priorité moyenne

- **Outil `mlt`** (More Like This) — articles similaires à un UNO donné (`apicore.mlt(uno, lang)`)
- **Outil `list`** — lister les valeurs d'une facette (slugs, genres, pays) avec leur fréquence (`apicore.list(facet, params)`), utile pour découvrir les sujets tendance
- **Pagination sur search** — paramètre `offset`/`page`, ou exploiter `apicore.searchAll()` (async generator)
- **Filtres supplémentaires sur search** — `country`, `product` (photos, vidéos), `topic`/`slug`

### Priorité basse

- **MCP Resources** — exposer du contenu passif : `afp://breaking` (dernières dépêches), `afp://topics` (sujets tendance via `list('slug')`)
- **MCP Prompts** — templates : `daily-briefing` (actu du jour), `topic-deep-dive` (search + mlt croisés), `country-news` (filtre pays)
- **Notifications / veille** — exploiter le Notification Center de l'API (`registerService`, `addSubscription`) pour créer des alertes par webhook ou email
