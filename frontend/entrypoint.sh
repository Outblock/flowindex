#!/bin/sh

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

# Execute the original Nginx entrypoint
# This will handle envsubst for templates using the DNS_RESOLVER variable we just set
exec /docker-entrypoint.sh "$@"
