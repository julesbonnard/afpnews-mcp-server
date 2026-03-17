FROM oven/bun:1.3.10-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
ENV MCP_TRANSPORT=http
EXPOSE 3000
CMD ["bun", "src/index.js"]
