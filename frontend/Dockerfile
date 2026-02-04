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

# Serve Stage
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# Use templates for env substitution (handled by 20-envsubst-on-templates.sh in nginx image)
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template

# Custom entrypoint to inject DNS_RESOLVER
COPY frontend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
