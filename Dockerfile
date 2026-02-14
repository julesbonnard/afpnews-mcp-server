FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY build/ build/
ENV MCP_TRANSPORT=http
EXPOSE 3000
CMD ["node", "build/index.js"]
