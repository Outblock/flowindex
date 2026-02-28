#!/bin/sh
set -e

# Generate htpasswd from env vars
STUDIO_USER="${STUDIO_USER:-admin}"
STUDIO_PASSWORD="${STUDIO_PASSWORD:-changeme}"
htpasswd -bc /etc/nginx/.htpasswd "$STUDIO_USER" "$STUDIO_PASSWORD"

# Resolve env vars in nginx template
export STUDIO_UPSTREAM="${STUDIO_UPSTREAM:-http://127.0.0.1:3100}"
envsubst '$STUDIO_UPSTREAM' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
