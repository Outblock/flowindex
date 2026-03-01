#!/bin/sh
set -eu

STUDIO_USER="${STUDIO_USER:-admin}"
STUDIO_PASSWORD="${STUDIO_PASSWORD:-changeme}"
STUDIO_UPSTREAM="${STUDIO_UPSTREAM:-http://127.0.0.1:3100}"
TEMPLATE_PATH="/etc/nginx/templates/default.conf.template"
OUTPUT_PATH="/etc/nginx/conf.d/default.conf"

hash_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
    return 0
  fi

  if command -v openssl >/dev/null 2>&1; then
    printf '%s' "$1" | openssl dgst -sha256 | awk '{print $NF}'
    return 0
  fi

  echo "Failed to generate session token: sha256sum/openssl not found" >&2
  return 1
}

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

if [ ! -f "$TEMPLATE_PATH" ]; then
  echo "Nginx template not found: $TEMPLATE_PATH" >&2
  exit 1
fi

STUDIO_SESSION_TOKEN="$(hash_sha256 "${STUDIO_USER}:${STUDIO_PASSWORD}")"

escaped_upstream="$(escape_sed_replacement "$STUDIO_UPSTREAM")"
escaped_token="$(escape_sed_replacement "$STUDIO_SESSION_TOKEN")"

sed \
  -e "s|\${STUDIO_UPSTREAM}|$escaped_upstream|g" \
  -e "s|\${STUDIO_SESSION_TOKEN}|$escaped_token|g" \
  "$TEMPLATE_PATH" > "$OUTPUT_PATH"

nginx -t
exec nginx -g 'daemon off;'
