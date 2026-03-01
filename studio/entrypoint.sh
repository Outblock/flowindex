#!/bin/sh
set -e

STUDIO_USER="${STUDIO_USER:-admin}"
STUDIO_PASSWORD="${STUDIO_PASSWORD:-changeme}"

# Generate session token: sha256 hex hash (URL-safe, no padding issues)
export STUDIO_SESSION_TOKEN=$(printf '%s:%s' "$STUDIO_USER" "$STUDIO_PASSWORD" | sha256sum | cut -d' ' -f1)
export STUDIO_UPSTREAM="${STUDIO_UPSTREAM:-http://127.0.0.1:3100}"

# Resolve env vars in nginx template
envsubst '${STUDIO_UPSTREAM} ${STUDIO_SESSION_TOKEN}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
