# afpnews-mcp

MCP (Model Context Protocol) server that exposes [AFP](https://www.afp.com/) news content as tools for AI assistants. Works with any MCP-compatible client: Claude Code, Claude Desktop, Continue, Cursor, etc.

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/)
- An AFP API account (API key + username/password)

## Setup

```bash
git clone https://github.com/julesbonnard/afpnews-mcp.git
cd afpnews-mcp
pnpm install
pnpm run build
```

Create a `.env` file:

```
APICORE_API_KEY=your-api-key
APICORE_USERNAME=your-username
APICORE_PASSWORD=your-password
```

Or for stdio only, provide a serialized auth token instead:

```
APICORE_AUTH_TOKEN={"accessToken":"...","refreshToken":"...","tokenExpires":1735689600000,"authType":"credentials"}
```

## Usage

### Stdio transport (default)

For local MCP clients like Claude Code or Claude Desktop:

```bash
pnpm run start
```

Direct CLI call (same stdio behavior):

```bash
APICORE_AUTH_TOKEN='{"accessToken":"...","refreshToken":"...","tokenExpires":1735689600000,"authType":"credentials"}' node build/index.js
```

#### Claude Code

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "afpnews": {
      "command": "node",
      "args": ["build/index.js"],
      "cwd": "/path/to/afpnews-mcp",
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

For remote or multi-user deployments. Each session authenticates independently via HTTP Basic Auth (username/password are your AFP credentials).

```bash
MCP_TRANSPORT=http PORT=3000 pnpm run start
```

### Docker

```bash
pnpm run build
docker build -t afpnews-mcp .
docker run -e APICORE_API_KEY=your-api-key -p 3000:3000 afpnews-mcp
```

## Tools

| Tool | Description |
|------|-------------|
| `search` | Search AFP articles with filters, presets, and full-text mode |
| `get` | Get a full article by its UNO identifier |
| `mlt` | Find similar articles (More Like This) from a UNO |
| `list` | List facet values (topics, genres, countries) with frequency counts |

### Search presets

The `search` tool supports presets that apply predefined filters:

- **`a-la-une`** — Top story (French, last 24h)
- **`agenda`** — Upcoming events
- **`previsions`** — Editorial planning / forecasts
- **`major-stories`** — Major articles

### List preset

- **`trending-topics`** — Trending topics from the last 24h

### Full text

By default, `search` returns excerpts (first 4 paragraphs). Set `fullText: true` to get the complete article body. Presets default to full text.

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
pnpm install
pnpm run build
pnpm test
```

## License

ISC
