# afpnews-mcp

MCP (Model Context Protocol) server that exposes [AFP](https://www.afp.com/) news content as tools for AI assistants. Works with any MCP-compatible client.

The package can also be used as a library without MCP server glue via `afpnews-mcp-server/definitions`.

## Prerequisites

- [Bun](https://bun.sh/) 1.3+
- An AFP API account (API key + username/password)

## Setup

```bash
git clone https://github.com/julesbonnard/afpnews-mcp-server.git
cd afpnews-mcp-server
bun install
```

Create a `.env` file:

```
APICORE_API_KEY=your-api-key
APICORE_USERNAME=your-username
APICORE_PASSWORD=your-password
```

## Usage

### Stdio transport (default)

For local MCP clients like Claude Code or Claude Desktop:

```json
{
  "mcpServers": {
    "afpnews": {
      "command": "bun",
      "args": ["src/index.ts"],
      "cwd": "/absolute/path/to/afpnews-mcp-server",
      "env": {
        "APICORE_API_KEY": "your-api-key",
        "APICORE_USERNAME": "your-username",
        "APICORE_PASSWORD": "your-password"
      }
    }
  }
}
```

### HTTP transport

For remote or multi-user deployments. Users authenticate via OAuth2 PKCE using their AFP credentials.

Required environment variables for HTTP mode:

```
APICORE_API_KEY=your-api-key
APICORE_BASE_URL=https://api.afp.com
MCP_SERVER_URL=https://news-mcp.example.com
JWT_SECRET=a-random-string-of-at-least-32-characters
MCP_TRANSPORT=http
PORT=3000
```

Optional:
- `MCP_SESSION_TTL` — session duration in milliseconds (default: 3600000 = 1h)
- `MCP_ALLOWED_REDIRECT_URIS` — comma-separated list of allowed OAuth redirect URIs

```bash
bun src/index.ts
```

If you expose the server remotely, use HTTPS.

### Docker

```bash
docker build -t afpnews-mcp .
docker run \
  -e APICORE_API_KEY=your-api-key \
  -e APICORE_BASE_URL=https://api.afp.com \
  -e MCP_SERVER_URL=https://news-mcp.example.com \
  -e JWT_SECRET=your-secret-32-chars-minimum \
  -e MCP_TRANSPORT=http \
  -p 3000:3000 \
  afpnews-mcp
```

### As a library (without MCP server dependency)

You can import pure definitions (tools, prompts, resources) and wire them into your own runtime:

```ts
import { AFP_DEFINITIONS } from 'afpnews-mcp-server/definitions';

const { tools, prompts, resources } = AFP_DEFINITIONS;
```

Or import each collection directly:

```ts
import {
  TOOL_DEFINITIONS,
  PROMPT_DEFINITIONS,
  RESOURCE_DEFINITIONS,
} from 'afpnews-mcp-server/definitions';
```

Each definition is framework-agnostic:
- `tools`: `name`, `title`, `description`, `inputSchema`, `handler(apicore, args)`
- `prompts`: `name`, `title`, `description`, `argsSchema`, `handler(args)`
- `resources`: `name`, `uri`, `description`, `mimeType`, `handler()`

## Tools

| Tool | Description |
|------|-------------|
| `afp_search_articles` | Search AFP articles with filters, presets, and full-text mode |
| `afp_get_article` | Get a full article by its UNO identifier |
| `afp_find_similar` | Find similar articles (More Like This) from a UNO |
| `afp_list_facets` | List facet values (topics, genres, countries) with frequency counts |
| `afp_search_media` | Search AFP media documents (photos, videos, graphics) |
| `afp_get_media` | Get a full media document by UNO, with optional base64 image embed |

### Search presets

The `afp_search_articles` tool supports presets that apply predefined filters:

- **`a-la-une`** — Top story (French, last 24h)
- **`agenda`** — Upcoming events
- **`previsions`** — Editorial planning / forecasts
- **`major-stories`** — Major articles

### List preset

- **`trending-topics`** — Trending topics from the last 24h

### Full text

By default, `afp_search_articles` returns excerpts (first 4 paragraphs). Set `fullText: true` to get the complete article body. Presets default to full text.

## Prompts

| Prompt | Description |
|--------|-------------|
| `daily-briefing` | Generate a daily news briefing |
| `comprehensive-analysis` | In-depth analysis on a topic |
| `factcheck` | Verify facts using AFP factchecks |
| `country-news` | News summary for a specific country |

## Resources

| Resource | Description |
|----------|-------------|
| `afp://topics` | AFP Stories topic catalog by language |

## Development

```bash
bun install
bun test
```

## Internal Architecture

- `src/tools/*.ts`, `src/prompts/*.ts`, `src/resources/*.ts` contain pure definitions.
- `src/tools/index.ts`, `src/prompts/index.ts`, `src/resources/index.ts` contain MCP registration glue.
- `src/definitions.ts` exports aggregated, server-agnostic definitions:
  - `AFP_DEFINITIONS`
  - `TOOL_DEFINITIONS`
  - `PROMPT_DEFINITIONS`
  - `RESOURCE_DEFINITIONS`

## License

ISC
