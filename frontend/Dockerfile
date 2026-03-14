# Build Stage (Bun)
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Workspace root config + lockfile
COPY package.json bun.lock nx.json ./

# Shared monorepo packages (needed for workspace:* resolution)
COPY packages/ ./packages/

# Frontend package.json
COPY frontend/package.json ./frontend/

# Scope workspaces to only what's present (bun requires all listed members to exist)
RUN bun -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));p.workspaces=['packages/*','frontend'];require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"

# Install all workspace deps
RUN cd frontend && bun install

# Build shared packages (nx resolves dependency order via tag:package)
RUN bunx nx run-many -t build --projects=tag:package

# Copy frontend source and build
COPY frontend/ ./frontend/
# Single-source OpenAPI spec from repo root
COPY openapi-v2.json ./frontend/public/openapi/v2.json
WORKDIR /app/frontend
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_DOCS_URL
ENV VITE_DOCS_URL=$VITE_DOCS_URL
ARG VITE_GOTRUE_URL
ENV VITE_GOTRUE_URL=$VITE_GOTRUE_URL
ARG VITE_SUPABASE_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON
ARG VITE_PASSKEY_RP_ID
ENV VITE_PASSKEY_RP_ID=$VITE_PASSKEY_RP_ID
ARG VITE_PASSKEY_RP_NAME
ENV VITE_PASSKEY_RP_NAME=$VITE_PASSKEY_RP_NAME
ARG VITE_SIM_STUDIO_URL
ENV VITE_SIM_STUDIO_URL=$VITE_SIM_STUDIO_URL
ARG VITE_GIT_COMMIT
ENV VITE_GIT_COMMIT=$VITE_GIT_COMMIT
# Force Bun runtime output regardless of environment defaults
ENV NITRO_PRESET=bun
RUN VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON" bun run build

# Run Stage (SSR server + Nginx reverse proxy for /api + /ws)
FROM oven/bun:1-alpine

WORKDIR /app

# Nginx for same-origin /api + /ws proxying to the backend service (Railway/Docker).
RUN apk add --no-cache nginx gettext

# SSR build output produced by Nitro
COPY --from=builder /app/frontend/.output /app/.output

# Nginx config template + entrypoint
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
COPY frontend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
CMD []
