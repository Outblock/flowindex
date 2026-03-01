FROM oven/bun:1 AS frontend-builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
ARG VITE_AI_CHAT_URL=https://ai.flowindex.io
ENV VITE_AI_CHAT_URL=$VITE_AI_CHAT_URL
RUN bun run build

FROM node:20-alpine AS server-builder
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci
COPY server/ .
RUN npm run build

FROM nginx:alpine
# Install Node.js and supervisord
RUN apk add --no-cache nodejs npm supervisor
# Install Flow CLI
RUN wget -qO /usr/local/bin/flow \
    "https://github.com/onflow/flow-cli/releases/download/v2.2.6/flow-x86_64-linux" \
    && chmod +x /usr/local/bin/flow
# Copy frontend static files
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
# Copy server
COPY --from=server-builder /app/server/dist /app/server
COPY --from=server-builder /app/server/node_modules /app/server/node_modules
# Copy configs
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY supervisord.conf /etc/supervisord.conf
EXPOSE 80
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
