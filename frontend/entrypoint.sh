#!/bin/sh

# This container runs:
# 1) Nitro SSR server on 127.0.0.1:SSR_PORT (internal, default 4000)
# 2) Nginx on :LISTEN_PORT (public, default $PORT or 8080) proxying:
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

# GoTrue (Supabase Auth) URL for nginx proxy
if [ -z "${GOTRUE_URL:-}" ]; then
    export GOTRUE_URL="http://127.0.0.1:9999"
fi

echo "Backend API: $BACKEND_API"
echo "Backend WS:  $BACKEND_WS"
echo "GoTrue URL:  $GOTRUE_URL"

# Generate runtime config for the app (safe, public values only).
# This lets us set DOCS_URL without rebuilding the frontend image.
if [ -f /app/.output/public/env.template.js ]; then
    envsubst '$DOCS_URL $FLOW_NETWORK $UMAMI_WEBSITE_ID' < /app/.output/public/env.template.js > /app/.output/public/env.js
    echo "Docs URL:    ${DOCS_URL:-}"
    echo "Network:     ${FLOW_NETWORK:-mainnet}"
    echo "Umami ID:    ${UMAMI_WEBSITE_ID:-default}"
fi

# Nginx listens on PORT (Railway/GCP sets this); SSR server on a separate internal port.
export LISTEN_PORT="${PORT:-8080}"
export SSR_PORT="${SSR_PORT:-4000}"

# SSR server-side API calls need an absolute URL. When VITE_API_URL is relative ("/api"),
# resolve it against the local Nginx listener so we keep same-origin semantics.
export SSR_API_ORIGIN="${SSR_API_ORIGIN:-http://127.0.0.1:${LISTEN_PORT}}"

# Render nginx template (envsubst) for backend proxy + SSR upstream.
mkdir -p /etc/nginx/http.d
envsubst '$DNS_RESOLVER $BACKEND_API $BACKEND_WS $GOTRUE_URL $LISTEN_PORT $SSR_PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/http.d/default.conf

# Patch Bun.serve idleTimeout (default 10s is too short for SSR rendering)
sed -i 's/bun: { websocket: void 0 }/bun: { websocket: void 0, idleTimeout: 255 }/' /app/.output/server/index.mjs

# Start Nitro SSR server on internal port
echo "Starting Nitro SSR server on :${SSR_PORT}"
PORT=${SSR_PORT} bun /app/.output/server/index.mjs &
SSR_PID=$!

# Validate & start Nginx (public listener on LISTEN_PORT)
echo "Testing nginx config..."
nginx -t 2>&1
echo "Starting Nginx on :${LISTEN_PORT}"
nginx -g "daemon off;" &
NGINX_PID=$!

trap 'echo "Shutting down..."; kill -TERM "$NGINX_PID" "$SSR_PID" 2>/dev/null; wait "$NGINX_PID" 2>/dev/null; wait "$SSR_PID" 2>/dev/null; exit 0' INT TERM

wait "$NGINX_PID"
