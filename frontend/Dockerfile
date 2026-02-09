# Build Stage (IMPORTANT: build under Node, not Bun)
# If you build Nitro output under Bun, bundling can constant-fold `typeof Bun !== 'undefined'`
# and produce a server bundle that hard-requires `Bun.serve()` at runtime.
FROM node:22-alpine AS builder

WORKDIR /app

# Toolchain for any native deps during `npm ci`
RUN apk add --no-cache python3 make g++

COPY frontend/package.json frontend/package-lock.json ./
# Avoid running lifecycle scripts (husky) inside container builds.
RUN npm ci --ignore-scripts

COPY frontend/ .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_DOCS_URL
ENV VITE_DOCS_URL=$VITE_DOCS_URL
# Force node-server output regardless of environment defaults
ENV NITRO_PRESET=node-server
RUN npm run build

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
