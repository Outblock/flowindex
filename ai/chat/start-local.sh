#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Start the dual-target Vanna SQL service locally.
#
# Modes:
#   1) Direct DB mode:
#      - Use FLOWINDEX_DATABASE_URL / BLOCKSCOUT_DATABASE_URL as-is
#   2) Tunnel mode (default):
#      - Use local env URLs if provided, otherwise fetch them from the backend VM
#      - Open IAP tunnels through a jump VM for each database host
#
# What it does:
#   1. Loads local .env if present
#   2. Resolves FlowIndex and optional Blockscout DB URLs
#   3. Optionally opens tunnels for each DB
#   4. Installs Python deps into .venv if needed
#   5. Verifies DB connectivity
#   6. Starts the dual-target Vanna server on :8084
#
# Prerequisites:
#   - Python 3.11+
#   - ANTHROPIC_API_KEY set in env or .env file
#   - For tunnel mode: gcloud CLI authenticated with IAP access
#
# Usage:
#   bash ai/chat/start-local.sh
#   bash ai/chat/start-local.sh --direct-db
#   bash ai/chat/start-local.sh --port 9000
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${GCP_PROJECT:-your-gcp-project}"
ZONE="${GCP_ZONE:-us-west1-a}"
BACKEND_VM="${BACKEND_VM:-backend}"
FLOWINDEX_JUMP_VM="${FLOWINDEX_JUMP_VM:-$BACKEND_VM}"
BLOCKSCOUT_JUMP_VM="${BLOCKSCOUT_JUMP_VM:-$BACKEND_VM}"
FLOWINDEX_LOCAL_PORT="${FLOWINDEX_LOCAL_PORT:-15432}"
BLOCKSCOUT_LOCAL_PORT="${BLOCKSCOUT_LOCAL_PORT:-15433}"
SERVER_PORT="${SERVER_PORT:-8084}"
AI_CHAT_ENV_PATH="${AI_CHAT_ENV_PATH:-/mnt/stateful_partition/pgdata/ai-chat.env}"
BACKEND_ENV_PATH="${BACKEND_ENV_PATH:-/mnt/stateful_partition/pgdata/backend.env}"
LEGACY_BACKEND_ENV_PATH="${LEGACY_BACKEND_ENV_PATH:-/opt/blockscout-backend/backend.env}"
DIRECT_DB=false

declare -a TUNNEL_PIDS=()

usage() {
  cat <<'EOF'
Usage: start-local.sh [options]

Options:
  --port PORT                Server port (default: 8084)
  --local-db-port PORT       Backward-compatible alias for --flowindex-db-port
  --flowindex-db-port PORT   Local port for the FlowIndex DB tunnel (default: 15432)
  --blockscout-db-port PORT  Local port for the Blockscout DB tunnel (default: 15433)
  --project NAME             GCP project
  --zone ZONE                GCP zone
  --backend-vm NAME          Default jump VM (default: backend)
  --direct-db                Use DB URLs directly, without opening tunnels
  -h, --help                 Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) SERVER_PORT="${2:-}"; shift 2 ;;
    --local-db-port) FLOWINDEX_LOCAL_PORT="${2:-}"; shift 2 ;;
    --flowindex-db-port) FLOWINDEX_LOCAL_PORT="${2:-}"; shift 2 ;;
    --blockscout-db-port) BLOCKSCOUT_LOCAL_PORT="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    --zone) ZONE="${2:-}"; shift 2 ;;
    --backend-vm)
      BACKEND_VM="${2:-}"
      FLOWINDEX_JUMP_VM="${2:-}"
      BLOCKSCOUT_JUMP_VM="${2:-}"
      shift 2
      ;;
    --direct-db) DIRECT_DB=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

log() { printf "\033[1;34m[vanna]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[vanna]\033[0m %s\n" "$*" >&2; }
ok()  { printf "\033[1;32m[vanna]\033[0m %s\n" "$*"; }

cleanup() {
  local pid
  for pid in "${TUNNEL_PIDS[@]:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      log "Closing tunnel (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    err "Missing: $1"
    exit 127
  }
}

load_local_env() {
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    log "Loading $SCRIPT_DIR/.env"
    set -a
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/.env"
    set +a
  fi
}

fetch_remote_env_lines() {
  gcloud compute ssh "$BACKEND_VM" \
    --zone "$ZONE" \
    --project "$PROJECT" \
    --quiet \
    --tunnel-through-iap \
    --ssh-flag="-o StrictHostKeyChecking=no" \
    --command "bash -lc '
set -euo pipefail
for f in \"$AI_CHAT_ENV_PATH\" \"$BACKEND_ENV_PATH\" \"$LEGACY_BACKEND_ENV_PATH\"; do
  [ -f \"$f\" ] || continue
  while IFS= read -r line || [ -n \"\$line\" ]; do
    case \"\$line\" in
      FLOWINDEX_DATABASE_URL=*|BLOCKSCOUT_DATABASE_URL=*|DATABASE_URL=*)
        printf \"%s\n\" \"\$line\"
        ;;
    esac
  done < \"\$f\"
done
'"
}

extract_var_from_lines() {
  local key="$1"
  local lines="$2"
  printf '%s\n' "$lines" | sed -n "s/^${key}=//p" | tail -n 1
}

parse_db_url_field() {
  local field="$1"
  local url="$2"
  DB_URL="$url" DB_FIELD="$field" python3 - <<'PY'
import os
import urllib.parse

p = urllib.parse.urlparse(os.environ["DB_URL"].strip())
field = os.environ["DB_FIELD"]

values = {
    "host": p.hostname or "localhost",
    "port": str(p.port or 5432),
    "dbname": (p.path or "").lstrip("/") or "postgres",
}

print(values[field])
PY
}

rewrite_db_url_to_local() {
  local local_port="$1"
  local url="$2"
  LOCAL_PORT="$local_port" DB_URL="$url" python3 - <<'PY'
import os
import urllib.parse

local_port = os.environ["LOCAL_PORT"]
p = urllib.parse.urlparse(os.environ["DB_URL"].strip())

username = urllib.parse.quote(urllib.parse.unquote(p.username or ""), safe="")
password = urllib.parse.quote(urllib.parse.unquote(p.password or ""), safe="")

auth = ""
if username:
    auth = username
    if password:
        auth += f":{password}"
    auth += "@"

netloc = f"{auth}127.0.0.1:{local_port}"

print(
    urllib.parse.urlunparse(
        (p.scheme or "postgresql", netloc, p.path, p.params, p.query, p.fragment)
    )
)
PY
}

open_tunnel() {
  local name="$1"
  local jump_vm="$2"
  local target_host="$3"
  local target_port="$4"
  local local_port="$5"

  if lsof -i ":$local_port" >/dev/null 2>&1; then
    log "Port $local_port already in use — assuming existing $name tunnel."
    return 0
  fi

  log "Opening $name tunnel: localhost:$local_port → $target_host:$target_port via $jump_vm ..."
  gcloud compute ssh "$jump_vm" \
    --zone "$ZONE" \
    --project "$PROJECT" \
    --quiet \
    --tunnel-through-iap \
    --ssh-flag="-o StrictHostKeyChecking=no" \
    --ssh-flag="-N" \
    --ssh-flag="-L" \
    --ssh-flag="$local_port:$target_host:$target_port" &

  local pid=$!
  TUNNEL_PIDS+=("$pid")

  log "Waiting for $name tunnel..."
  for _ in $(seq 1 30); do
    if lsof -i ":$local_port" >/dev/null 2>&1; then
      ok "$name tunnel ready (PID $pid)"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      err "$name tunnel process exited unexpectedly."
      exit 1
    fi
    sleep 1
  done

  err "$name tunnel failed to open after 30s."
  exit 1
}

test_flowindex_connection() {
  log "Testing FlowIndex DB connection..."
  FLOWINDEX_DATABASE_URL="$FLOWINDEX_DATABASE_URL" python3 - <<'PY'
import os
import psycopg

with psycopg.connect(os.environ["FLOWINDEX_DATABASE_URL"], autocommit=True) as conn:
    row = conn.execute(
        """
        SELECT
          to_regclass('raw.transactions')::text AS transactions_table,
          to_regclass('app.market_prices')::text AS market_prices_table
        """
    ).fetchone()
    print(f"  raw.transactions={row[0]} app.market_prices={row[1]}")
PY
  ok "FlowIndex DB connection OK"
}

test_blockscout_connection() {
  if [[ -z "${BLOCKSCOUT_DATABASE_URL:-}" ]]; then
    log "BLOCKSCOUT_DATABASE_URL is not set — skipping Blockscout connectivity test."
    return 0
  fi

  log "Testing Blockscout DB connection..."
  BLOCKSCOUT_DATABASE_URL="$BLOCKSCOUT_DATABASE_URL" python3 - <<'PY'
import os
import psycopg2

conn = psycopg2.connect(os.environ["BLOCKSCOUT_DATABASE_URL"])
conn.autocommit = True
try:
    cur = conn.cursor()
    cur.execute("SELECT to_regclass('public.blocks')::text")
    row = cur.fetchone()
    print(f"  public.blocks={row[0]}")
finally:
    conn.close()
PY
  ok "Blockscout DB connection OK"
}

# --- Pre-flight ---
require_command python3
load_local_env

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  err "ANTHROPIC_API_KEY is not set."
  err "Set it in ai/chat/.env or export it before running."
  exit 1
fi

if [[ "$DIRECT_DB" != true ]]; then
  require_command gcloud
fi

FLOWINDEX_DB_URL="${FLOWINDEX_DATABASE_URL:-${DATABASE_URL:-}}"
BLOCKSCOUT_DB_URL="${BLOCKSCOUT_DATABASE_URL:-}"

if [[ -z "$FLOWINDEX_DB_URL" || -z "$BLOCKSCOUT_DB_URL" ]]; then
  if [[ "$DIRECT_DB" == true ]]; then
    [[ -n "$FLOWINDEX_DB_URL" ]] || {
      err "FLOWINDEX_DATABASE_URL or DATABASE_URL must be set in direct DB mode."
      exit 1
    }
  else
    log "Fetching DB URLs from $BACKEND_VM via IAP..."
    REMOTE_ENV_LINES="$(fetch_remote_env_lines || true)"

    if [[ -z "$FLOWINDEX_DB_URL" ]]; then
      FLOWINDEX_DB_URL="$(extract_var_from_lines "FLOWINDEX_DATABASE_URL" "$REMOTE_ENV_LINES")"
      if [[ -z "$FLOWINDEX_DB_URL" ]]; then
        FLOWINDEX_DB_URL="$(extract_var_from_lines "DATABASE_URL" "$REMOTE_ENV_LINES")"
      fi
    fi

    if [[ -z "$BLOCKSCOUT_DB_URL" ]]; then
      BLOCKSCOUT_DB_URL="$(extract_var_from_lines "BLOCKSCOUT_DATABASE_URL" "$REMOTE_ENV_LINES")"
    fi
  fi
fi

if [[ -z "$FLOWINDEX_DB_URL" ]]; then
  err "Failed to resolve FlowIndex DB URL."
  exit 1
fi

if [[ "$DIRECT_DB" == true ]]; then
  export FLOWINDEX_DATABASE_URL="$FLOWINDEX_DB_URL"
  export BLOCKSCOUT_DATABASE_URL="$BLOCKSCOUT_DB_URL"
else
  FLOWINDEX_TARGET_HOST="$(parse_db_url_field host "$FLOWINDEX_DB_URL")"
  FLOWINDEX_TARGET_PORT="$(parse_db_url_field port "$FLOWINDEX_DB_URL")"
  open_tunnel "FlowIndex DB" "$FLOWINDEX_JUMP_VM" "$FLOWINDEX_TARGET_HOST" "$FLOWINDEX_TARGET_PORT" "$FLOWINDEX_LOCAL_PORT"
  export FLOWINDEX_DATABASE_URL="$(rewrite_db_url_to_local "$FLOWINDEX_LOCAL_PORT" "$FLOWINDEX_DB_URL")"

  if [[ -n "$BLOCKSCOUT_DB_URL" ]]; then
    BLOCKSCOUT_TARGET_HOST="$(parse_db_url_field host "$BLOCKSCOUT_DB_URL")"
    BLOCKSCOUT_TARGET_PORT="$(parse_db_url_field port "$BLOCKSCOUT_DB_URL")"
    open_tunnel "Blockscout DB" "$BLOCKSCOUT_JUMP_VM" "$BLOCKSCOUT_TARGET_HOST" "$BLOCKSCOUT_TARGET_PORT" "$BLOCKSCOUT_LOCAL_PORT"
    export BLOCKSCOUT_DATABASE_URL="$(rewrite_db_url_to_local "$BLOCKSCOUT_LOCAL_PORT" "$BLOCKSCOUT_DB_URL")"
  else
    export BLOCKSCOUT_DATABASE_URL=""
  fi
fi

# Legacy fallback for code paths that still read DATABASE_URL
export DATABASE_URL="$FLOWINDEX_DATABASE_URL"

# --- Setup Python environment ---
VENV_DIR="$SCRIPT_DIR/.venv"
if [[ ! -d "$VENV_DIR" ]]; then
  log "Creating virtualenv at $VENV_DIR ..."
  python3 -m venv "$VENV_DIR"
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

log "Installing dependencies..."
pip install -q -r "$SCRIPT_DIR/requirements.txt"

# --- Connectivity tests ---
test_flowindex_connection
test_blockscout_connection

# --- Start server ---
export PORT="$SERVER_PORT"
export VANNA_BASE_URL="${VANNA_BASE_URL:-http://127.0.0.1:${SERVER_PORT}}"

ok "Starting dual-target Vanna server"
echo ""
echo "  Web UI:                 http://localhost:${SERVER_PORT}"
echo "  API docs:               http://localhost:${SERVER_PORT}/docs"
echo "  FlowIndex ask:          http://localhost:${SERVER_PORT}/api/v1/flowindex/ask"
echo "  FlowIndex generate_sql: http://localhost:${SERVER_PORT}/api/v1/flowindex/generate_sql"
echo "  EVM ask:                http://localhost:${SERVER_PORT}/api/v1/evm/ask"
echo "  EVM generate_sql:       http://localhost:${SERVER_PORT}/api/v1/evm/generate_sql"
echo ""

cd "$SCRIPT_DIR"
exec python server.py
