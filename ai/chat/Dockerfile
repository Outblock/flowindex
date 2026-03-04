# Stage 1: Build Next.js frontend
FROM oven/bun:1 AS frontend
WORKDIR /app

# Copy local flowtoken package first (referenced by web/package.json)
COPY frontend/packages/flowtoken /frontend/packages/flowtoken

WORKDIR /app/web
COPY ai/chat/web/package.json ai/chat/web/bun.lock ./
RUN bun install
COPY ai/chat/web/ .
# Re-copy flowtoken (real dir) and fix symlink (Docker Buildx cache can break it)
COPY frontend/packages/flowtoken /frontend/packages/flowtoken
RUN rm -rf node_modules/@flowindex/flowtoken && \
    mkdir -p node_modules/@flowindex && \
    ln -s /frontend/packages/flowtoken node_modules/@flowindex/flowtoken
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN bun run build

# Stage 2: Python backend + MCP server + serve frontend
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev curl unzip nginx supervisor && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

COPY ai/chat/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ai/chat/ .

# Copy built frontend assets + node_modules from stage 1
COPY --from=frontend /app/web/.next ./web/.next
COPY --from=frontend /app/web/node_modules ./web/node_modules
COPY --from=frontend /app/web/package.json ./web/package.json
# Copy flowtoken package so the symlink in node_modules resolves at runtime
COPY --from=frontend /frontend/packages/flowtoken /frontend/packages/flowtoken

# Train on startup data (DDL + queries + docs baked into the image)
RUN python train.py

# nginx + supervisor configs (already in /app from COPY ai/chat/ above)
RUN cp nginx.conf /etc/nginx/sites-enabled/default \
    && cp supervisord.conf /etc/supervisor/conf.d/vanna.conf

EXPOSE 80 8084 8085 3001

CMD ["supervisord", "-n"]
