# Stage 1: Build Next.js frontend
FROM node:22-slim AS frontend
RUN npm install -g bun
WORKDIR /app

# Workspace root config + lockfile
COPY package.json bun.lock ./

# Shared monorepo packages (needed for workspace:* resolution)
COPY packages/ ./packages/

# AI chat web package.json
COPY ai/chat/web/package.json ./ai/chat/web/

# Scope workspaces to only what's present (bun requires all listed members to exist)
RUN node -e "const p=require('./package.json');p.workspaces=['packages/*','ai/chat/web'];require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"

# Install all workspace deps
RUN cd ai/chat/web && bun install

# Build shared packages (dependency order matters)
RUN cd packages/flow-passkey && bun run build \
 && cd ../auth-core && bun run build \
 && cd ../flowtoken && bun run build \
 && cd ../flow-ui && bun run build

# Copy app source and build
COPY ai/chat/web/ ./ai/chat/web/
# Skills directory (loadSkill tool reads at runtime via path walk-up)
COPY skills/ /app/skills/
WORKDIR /app/ai/chat/web
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npx next build

# Stage 2: Python backend + MCP server + serve frontend
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev curl unzip nginx supervisor nodejs && rm -rf /var/lib/apt/lists/*

COPY ai/chat/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ai/chat/ .

# Copy full standalone tree so bun-style symlinks (../../../../node_modules/.bun/*)
# resolve correctly from ai/chat/web/node_modules into standalone/node_modules.
RUN rm -rf ./web ./standalone
COPY --from=frontend /app/ai/chat/web/.next/standalone ./standalone
COPY --from=frontend /app/ai/chat/web/.next/static ./standalone/ai/chat/web/.next/static
COPY --from=frontend /app/ai/chat/web/public ./standalone/ai/chat/web/public

# Skills for runtime loadSkill tool (Next.js SSR reads these on request)
COPY --from=frontend /app/skills ./skills

# Train on startup data (DDL + queries + docs baked into the image)
RUN python train.py

# nginx + supervisor configs (already in /app from COPY ai/chat/ above)
RUN cp nginx.conf /etc/nginx/sites-enabled/default \
    && cp supervisord.conf /etc/supervisor/conf.d/vanna.conf

EXPOSE 80 8084 8085 3001

CMD ["supervisord", "-n"]
