# Build Stage
FROM oven/bun:1 AS builder

WORKDIR /app

COPY frontend/package.json frontend/bun.lock ./
RUN bun install

COPY frontend/ .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_DOCS_URL
ENV VITE_DOCS_URL=$VITE_DOCS_URL
RUN bun run build

# Run Stage (SSR server + Nginx reverse proxy for /api + /ws)
FROM node:22-alpine

WORKDIR /app

# Nginx for same-origin /api + /ws proxying to the backend service (Railway/Docker).
RUN apk add --no-cache nginx gettext

# SSR build output produced by Nitro
COPY --from=builder /app/.output /app/.output

# Nginx config template + entrypoint
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY frontend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
CMD []
