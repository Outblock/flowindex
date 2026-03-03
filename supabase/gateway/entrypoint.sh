#!/bin/sh

# Default port assignments for edge functions (override via env)
export GATEWAY_PORT="${GATEWAY_PORT:-54321}"
export PASSKEY_AUTH_PORT="${PASSKEY_AUTH_PORT:-8101}"
export FLOW_KEYS_PORT="${FLOW_KEYS_PORT:-8102}"
export RUNNER_PROJECTS_PORT="${RUNNER_PROJECTS_PORT:-8103}"
export GOTRUE_PORT="${GOTRUE_PORT:-9999}"
export POSTGREST_PORT="${POSTGREST_PORT:-3000}"

echo "Gateway port:         $GATEWAY_PORT"
echo "passkey-auth port:    $PASSKEY_AUTH_PORT"
echo "flow-keys port:       $FLOW_KEYS_PORT"
echo "runner-projects port: $RUNNER_PROJECTS_PORT"
echo "GoTrue port:          $GOTRUE_PORT"
echo "PostgREST port:       $POSTGREST_PORT"

envsubst '$GATEWAY_PORT $PASSKEY_AUTH_PORT $FLOW_KEYS_PORT $RUNNER_PROJECTS_PORT $GOTRUE_PORT $POSTGREST_PORT' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec "$@"
