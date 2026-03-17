FROM oven/bun:1.3.10-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
RUN bun run build

FROM oven/bun:1.3.10-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=builder /app/build/ build/
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
ENV MCP_TRANSPORT=http
EXPOSE 3000
CMD ["bun", "run", "build/index.js"]
