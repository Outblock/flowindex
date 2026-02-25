# Stage 1: Build Next.js frontend
FROM node:20-slim AS frontend
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
RUN npm run build

# Stage 2: Python backend + MCP server + serve frontend
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev nodejs npm nginx supervisor && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Copy built frontend assets + node_modules from stage 1
COPY --from=frontend /app/web/.next ./web/.next
COPY --from=frontend /app/web/node_modules ./web/node_modules

# Train on startup data (DDL + queries + docs baked into the image)
RUN python train.py

# nginx config
COPY nginx.conf /etc/nginx/sites-enabled/default

COPY supervisord.conf /etc/supervisor/conf.d/vanna.conf

EXPOSE 80 8084 8085 3001

CMD ["supervisord", "-n"]
