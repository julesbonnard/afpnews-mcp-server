FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
RUN pnpm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY --from=builder /app/build/ build/
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
ENV MCP_TRANSPORT=http
EXPOSE 3000
CMD ["node", "build/index.js"]
