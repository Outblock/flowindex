#!/bin/sh

# This container runs:
# 1) Nitro SSR server on 127.0.0.1:3000 (internal)
# 2) Nginx on :8080 (public) proxying:
#    - /api + /ws -> backend
#    - everything else -> Nitro SSR server

# Extract the first nameserver from /etc/resolv.conf
export DNS_RESOLVER=$(awk '/nameserver/ {print $2}' /etc/resolv.conf | head -n1)

# Fallback to Google DNS or standard Docker DNS if not found
if [ -z "$DNS_RESOLVER" ]; then
    echo "Warning: No nameserver found in /etc/resolv.conf, defaulting to 8.8.8.8"
    export DNS_RESOLVER="8.8.8.8"
fi

# If resolver is IPv6 (contains colon), wrap in brackets for Nginx syntax
# Using case/esac for maximum portability (works in sh/ash/bash)
case "$DNS_RESOLVER" in
    *:*) export DNS_RESOLVER="[$DNS_RESOLVER]" ;;
esac


echo "Detected DNS Resolver: $DNS_RESOLVER"

# Backend target (override via env for Railway/GCP)
if [ -z "${BACKEND_API:-}" ]; then
    if [ -n "${RAILWAY_ENVIRONMENT:-}" ] || [ -n "${RAILWAY_PROJECT_ID:-}" ] || [ -n "${RAILWAY_PRIVATE_DOMAIN:-}" ]; then
        export BACKEND_API="http://backend.railway.internal:8080"
    else
        export BACKEND_API="http://backend:8080"
    fi
fi

if [ -z "${BACKEND_WS:-}" ]; then
    export BACKEND_WS="${BACKEND_API}"
fi

echo "Backend API: $BACKEND_API"
echo "Backend WS:  $BACKEND_WS"

# Generate runtime config for the app (safe, public values only).
# This lets us set DOCS_URL without rebuilding the frontend image.
if [ -f /app/.output/public/env.template.js ]; then
    envsubst '$DOCS_URL' < /app/.output/public/env.template.js > /app/.output/public/env.js
    echo "Docs URL:    ${DOCS_URL:-}"
fi

# SSR server-side API calls need an absolute URL. When VITE_API_URL is relative ("/api"),
# resolve it against the local Nginx listener so we keep same-origin semantics.
export SSR_API_ORIGIN="${SSR_API_ORIGIN:-http://127.0.0.1:8080}"

# Render nginx template (envsubst) for backend proxy + SSR upstream.
mkdir -p /etc/nginx/http.d
envsubst '$DNS_RESOLVER $BACKEND_API $BACKEND_WS' < /etc/nginx/templates/default.conf.template > /etc/nginx/http.d/default.conf

# Start Nitro SSR server on port 3000
echo "Starting Nitro SSR server on :3000"
PORT=3000 bun /app/.output/server/index.mjs &
SSR_PID=$!

# Start Nginx (public listener on :8080)
echo "Starting Nginx on :8080"
nginx -g "daemon off;" &
NGINX_PID=$!

trap 'echo "Shutting down..."; kill -TERM "$NGINX_PID" "$SSR_PID" 2>/dev/null; wait "$NGINX_PID" 2>/dev/null; wait "$SSR_PID" 2>/dev/null; exit 0' INT TERM

wait "$NGINX_PID"
