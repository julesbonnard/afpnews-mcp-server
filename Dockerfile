FROM oven/bun:1.3.10-alpine

WORKDIR /app

# 1. Installer les deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# 2. Copier le code de l’app
COPY . .

# 3. User non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

ENV MCP_TRANSPORT=http
EXPOSE 3000

CMD ["bun", "src/index.js"]
