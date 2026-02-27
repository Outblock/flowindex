#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Start Vanna v2 SQL service locally with an IAP tunnel to the GCP database.
#
# What it does:
#   1. Fetches DATABASE_URL from the backend VM (via IAP)
#   2. Opens an IAP SSH tunnel: localhost:15432 → db VM :5432
#   3. Installs Python deps (if needed)
#   4. Starts the Vanna v2 server with Web UI on :8084
#
# Prerequisites:
#   - gcloud CLI authenticated (gcloud auth login)
#   - IAP access to your GCP project
#   - Python 3.11+
#   - ANTHROPIC_API_KEY set in env or .env file
#
# Usage:
#   bash tools/vanna-sql/start-local.sh
#   bash tools/vanna-sql/start-local.sh --port 9000
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${GCP_PROJECT:-your-gcp-project}"
ZONE="${GCP_ZONE:-us-west1-a}"
BACKEND_VM="${BACKEND_VM:-backend}"
DB_VM="${DB_VM:-db}"
LOCAL_PORT="${LOCAL_PORT:-15432}"
SERVER_PORT="${SERVER_PORT:-8084}"
TUNNEL_PID=""

usage() {
  cat <<'EOF'
Usage: start-local.sh [options]

Options:
  --port PORT        Server port (default: 8084)
  --local-db-port P  Local port for DB tunnel (default: 15432)
  --project NAME     GCP project
  --zone ZONE        GCP zone
  -h, --help         Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) SERVER_PORT="${2:-}"; shift 2 ;;
    --local-db-port) LOCAL_PORT="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    --zone) ZONE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

log()  { printf "\033[1;34m[vanna]\033[0m %s\n" "$*"; }
err()  { printf "\033[1;31m[vanna]\033[0m %s\n" "$*" >&2; }
ok()   { printf "\033[1;32m[vanna]\033[0m %s\n" "$*"; }

cleanup() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    log "Closing IAP tunnel (PID $TUNNEL_PID)..."
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# --- Pre-flight checks ---
for cmd in gcloud python3; do
  command -v "$cmd" >/dev/null 2>&1 || { err "Missing: $cmd"; exit 127; }
done

# --- Load .env if present ---
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  log "Loading $SCRIPT_DIR/.env"
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
  set +a
fi

# --- Check for ANTHROPIC_API_KEY ---
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  err "ANTHROPIC_API_KEY is not set."
  err "Set it in tools/vanna-sql/.env or export it before running."
  exit 1
fi

# --- Step 1: Fetch DATABASE_URL from backend VM ---
log "Fetching DATABASE_URL from $BACKEND_VM via IAP..."
RAW_DB_URL="$(
  gcloud compute ssh "$BACKEND_VM" \
    --zone "$ZONE" \
    --project "$PROJECT" \
    --quiet \
    --tunnel-through-iap \
    --ssh-flag="-o StrictHostKeyChecking=no" \
    --command "bash -lc 'grep -E \"^DATABASE_URL=\" /opt/blockscout-backend/backend.env | head -n 1'" \
  | sed -E 's/^DATABASE_URL=//' \
  | grep -E '^postgresql://' \
  | head -n 1
)" || true

if [[ -z "$RAW_DB_URL" ]]; then
  err "Failed to fetch DATABASE_URL from backend VM."
  err "Make sure you have IAP access: gcloud compute ssh $BACKEND_VM --tunnel-through-iap --project $PROJECT --zone $ZONE"
  exit 1
fi

# Parse user/pass/db from the remote URL
read -r DB_USER DB_PASS DB_NAME < <(
  DB_URL="$RAW_DB_URL" python3 -c "
import os, urllib.parse
p = urllib.parse.urlparse(os.environ['DB_URL'].strip())
print(p.username or 'postgres', p.password or '', (p.path or '').lstrip('/') or 'blockscout')
"
)

ok "Got credentials: user=$DB_USER db=$DB_NAME"

# --- Step 2: Open IAP tunnel to DB ---
if lsof -i ":$LOCAL_PORT" >/dev/null 2>&1; then
  log "Port $LOCAL_PORT already in use — assuming existing tunnel."
else
  log "Opening IAP tunnel: localhost:$LOCAL_PORT → $DB_VM:5432 ..."
  gcloud compute ssh "$DB_VM" \
    --zone "$ZONE" \
    --project "$PROJECT" \
    --quiet \
    --tunnel-through-iap \
    --ssh-flag="-o StrictHostKeyChecking=no" \
    --ssh-flag="-N" \
    --ssh-flag="-L" \
    --ssh-flag="$LOCAL_PORT:localhost:5432" &
  TUNNEL_PID=$!

  log "Waiting for tunnel..."
  for i in $(seq 1 30); do
    if lsof -i ":$LOCAL_PORT" >/dev/null 2>&1; then
      ok "Tunnel ready (PID $TUNNEL_PID)"
      break
    fi
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      err "Tunnel process exited unexpectedly."
      exit 1
    fi
    sleep 1
  done

  if ! lsof -i ":$LOCAL_PORT" >/dev/null 2>&1; then
    err "Tunnel failed to open after 30s."
    exit 1
  fi
fi

# Build the local DATABASE_URL pointing through the tunnel
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${LOCAL_PORT}/${DB_NAME}"

# --- Step 3: Setup Python environment ---
VENV_DIR="$SCRIPT_DIR/.venv"
if [[ ! -d "$VENV_DIR" ]]; then
  log "Creating virtualenv at $VENV_DIR ..."
  python3 -m venv "$VENV_DIR"
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

log "Installing dependencies..."
pip install -q -r "$SCRIPT_DIR/requirements.txt"

# Quick connectivity test
log "Testing DB connection..."
if python3 -c "
import psycopg, os
with psycopg.connect(os.environ['DATABASE_URL'], autocommit=True) as conn:
    row = conn.execute('SELECT max(number) FROM blocks').fetchone()
    print(f'  Latest block: {row[0]}')
"; then
  ok "DB connection OK"
else
  err "Cannot connect to DB through tunnel. Check credentials and tunnel."
  exit 1
fi

# --- Step 4: Start Vanna v2 server ---
export PORT="$SERVER_PORT"
ok "Starting Vanna v2 server"
echo ""
echo "  Web UI:   http://localhost:$SERVER_PORT"
echo "  API docs: http://localhost:$SERVER_PORT/docs"
echo ""

cd "$SCRIPT_DIR"
exec python server.py
