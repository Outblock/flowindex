# Build Stage (Bun)
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Workspace root config + lockfile
COPY package.json bun.lock ./

# Shared monorepo packages (needed for workspace:* resolution)
COPY packages/ ./packages/

# Wallet package.json
COPY wallet/package.json ./wallet/

# Scope workspaces to only what's present (bun requires all listed members to exist)
RUN bun -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));p.workspaces=['packages/*','wallet'];require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"

# Install all workspace deps
RUN cd wallet && bun install

# Build shared packages (generate dist/ via tsup/tsc)
RUN cd packages/flow-passkey && bun run build \
 && cd ../auth-core && bun run build \
 && cd ../auth-ui && bun run build \
 && cd ../flow-ui && bun run build \
 && cd ../evm-wallet && bun run build

# Copy wallet source and build
COPY wallet/ ./wallet/
WORKDIR /app/wallet

ARG VITE_API_URL=https://flowindex.io
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_SUPABASE_URL=https://flowindex.io
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ARG VITE_RP_ID=flowindex.io
ENV VITE_RP_ID=$VITE_RP_ID

RUN bun run build

# Production: nginx serving static files
FROM nginx:alpine
COPY wallet/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/wallet/dist /usr/share/nginx/html
EXPOSE 5174
CMD ["nginx", "-g", "daemon off;"]
