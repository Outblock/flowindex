#!/bin/sh

# Detect DNS resolver from /etc/resolv.conf
export DNS_RESOLVER=$(awk '/nameserver/ {print $2}' /etc/resolv.conf | head -n1)
if [ -z "$DNS_RESOLVER" ]; then
    export DNS_RESOLVER="8.8.8.8"
fi

# Default upstream URLs (override via env at runtime)
export LISTEN_PORT="${PORT:-80}"
if [ -z "${GOTRUE_URL:-}" ]; then
    export GOTRUE_URL="http://127.0.0.1:9999"
fi
if [ -z "${SUPABASE_GATEWAY_URL:-}" ]; then
    export SUPABASE_GATEWAY_URL="http://127.0.0.1:54321"
fi
if [ -z "${BACKEND_API:-}" ]; then
    export BACKEND_API="http://10.128.0.4:8080"
fi
if [ -z "${SIMULATOR_API:-}" ]; then
    export SIMULATOR_API="http://10.128.0.5:9090"
fi

echo "Listen port:         $LISTEN_PORT"
echo "GoTrue URL:          $GOTRUE_URL"
echo "Supabase Gateway:    $SUPABASE_GATEWAY_URL"
echo "Backend API:         $BACKEND_API"
echo "Simulator API:       $SIMULATOR_API"

# Render nginx config from template
envsubst '$DNS_RESOLVER $LISTEN_PORT $GOTRUE_URL $SUPABASE_GATEWAY_URL $BACKEND_API $SIMULATOR_API' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

exec "$@"
