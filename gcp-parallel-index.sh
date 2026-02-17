#!/bin/bash
# gcp-parallel-index.sh — Launch parallel history indexing containers on GCP VM
# All containers connect to Cloud SQL and index different spork ranges.
# Usage:
#   ./gcp-parallel-index.sh start    — Start all containers
#   ./gcp-parallel-index.sh stop     — Stop and remove all containers
#   ./gcp-parallel-index.sh status   — Show container status + checkpoint progress
#   ./gcp-parallel-index.sh logs <name> [lines] — Tail logs for a container
#   ./gcp-parallel-index.sh restart <name>      — Restart a single container

set -euo pipefail

IMAGE="us-central1-docker.pkg.dev/flow-octopus/flowscan/backend:latest"
DB_URL="postgres://flowscan:secretpassword@34.69.114.28:5432/flowscan"

# Common env vars for all containers
COMMON_ENV=(
  -e DB_URL="$DB_URL"
  -e DB_MAX_OPEN_CONNS=60
  -e DB_MAX_IDLE_CONNS=30
  -e DB_SYNCHRONOUS_COMMIT=off
  -e RAW_ONLY=true
  -e ENABLE_FORWARD_INGESTER=false
  -e ENABLE_HISTORY_INGESTER=true
  -e HISTORY_BATCH_SIZE=2000
  -e PORT=0
)

# Node lists per spork group
NODES_S1="access-001.mainnet5.nodes.onflow.org:9000,access-001.mainnet4.nodes.onflow.org:9000,access-001.mainnet3.nodes.onflow.org:9000,access-001.mainnet2.nodes.onflow.org:9000,access-001.mainnet1.nodes.onflow.org:9000"
NODES_S2="access-001.mainnet10.nodes.onflow.org:9000,access-001.mainnet9.nodes.onflow.org:9000,access-001.mainnet8.nodes.onflow.org:9000,access-001.mainnet7.nodes.onflow.org:9000,access-001.mainnet6.nodes.onflow.org:9000"
NODES_S3="access-001.mainnet16.nodes.onflow.org:9000,access-001.mainnet15.nodes.onflow.org:9000,access-001.mainnet14.nodes.onflow.org:9000,access-001.mainnet13.nodes.onflow.org:9000,access-001.mainnet12.nodes.onflow.org:9000,access-001.mainnet11.nodes.onflow.org:9000"
NODES_S4="access-001.mainnet21.nodes.onflow.org:9000,access-001.mainnet20.nodes.onflow.org:9000,access-001.mainnet19.nodes.onflow.org:9000,access-001.mainnet18.nodes.onflow.org:9000,access-001.mainnet17.nodes.onflow.org:9000"
NODES_S5="access-001.mainnet25.nodes.onflow.org:9000,access-001.mainnet24.nodes.onflow.org:9000,access-001.mainnet23.nodes.onflow.org:9000,access-001.mainnet22.nodes.onflow.org:9000"
NODES_S6="access-001.mainnet26.nodes.onflow.org:9000"
NODES_S7="access-001.mainnet27.nodes.onflow.org:9000"

# Container definitions: name, start_block (top), stop_height (bottom), workers, nodes, rps
# Backward ingester goes from START_BLOCK downward to HISTORY_STOP_HEIGHT.
declare -A CONTAINERS
#          START_BLOCK  STOP_HEIGHT  WORKERS  RPS   NODES_VAR
CONTAINERS=(
  [history_s1]="12020337   7601063    30   -1   NODES_S1"   # Spork 1-5
  [history_s2]="15791891   12020337   30   -1   NODES_S2"   # Spork 6-10
  [history_s3]="23830813   15791891   30   -1   NODES_S3"   # Spork 11-16
  [history_s4]="47169687   23830813   40   -1   NODES_S4"   # Spork 17-21
  [history_s5]="65264629   47169687   40   -1   NODES_S5"   # Spork 22-25
  [history_s6]="85981135   65264629   40   -1   NODES_S6"   # Spork 26
  [history_s7]="137390146  85981135   50   -1   NODES_S7"   # Spork 27
)

start_container() {
  local name=$1
  local config=${CONTAINERS[$name]}
  read -r start_block stop_height workers rps nodes_var <<< "$config"
  local nodes=${!nodes_var}

  echo "Starting $name: blocks $start_block → $stop_height, workers=$workers, rps=$rps"

  docker run -d \
    --name "$name" \
    --restart unless-stopped \
    "${COMMON_ENV[@]}" \
    -e HISTORY_SERVICE_NAME="$name" \
    -e START_BLOCK="$start_block" \
    -e HISTORY_STOP_HEIGHT="$stop_height" \
    -e HISTORY_WORKER_COUNT="$workers" \
    -e FLOW_HISTORIC_ACCESS_NODES="$nodes" \
    -e FLOW_ACCESS_NODE="${nodes%%,*}" \
    -e FLOW_RPC_RPS="$rps" \
    -e FLOW_RPC_BURST=10000 \
    "$IMAGE"
}

cmd_start() {
  echo "=== Pulling latest image ==="
  docker pull "$IMAGE"

  echo ""
  echo "=== Starting 7 history indexing containers ==="
  for name in history_s1 history_s2 history_s3 history_s4 history_s5 history_s6 history_s7; do
    # Skip if already running
    if docker ps -q --filter "name=^${name}$" | grep -q .; then
      echo "  $name already running, skipping"
      continue
    fi
    # Remove stopped container if exists
    docker rm -f "$name" 2>/dev/null || true
    start_container "$name"
  done

  echo ""
  echo "=== All containers started ==="
  docker ps --filter "name=history_s" --format "table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}"
}

cmd_stop() {
  echo "Stopping all history indexing containers..."
  for name in history_s1 history_s2 history_s3 history_s4 history_s5 history_s6 history_s7; do
    docker stop "$name" 2>/dev/null && docker rm "$name" 2>/dev/null && echo "  Stopped $name" || true
  done
}

cmd_status() {
  echo "=== Container Status ==="
  docker ps --filter "name=history_s" --format "table {{.Names}}\t{{.Status}}\t{{.CreatedAt}}"

  echo ""
  echo "=== Checkpoint Progress ==="
  # Try to query the DB for checkpoint heights
  if command -v psql &>/dev/null; then
    psql "$DB_URL" -c "
      SELECT service_name,
             last_height,
             updated_at,
             EXTRACT(EPOCH FROM (NOW() - updated_at))::int AS seconds_ago
      FROM app.indexing_checkpoints
      WHERE service_name LIKE 'history_s%'
      ORDER BY service_name;
    " 2>/dev/null || echo "(psql not available or DB unreachable — check docker logs instead)"
  else
    echo "(psql not installed — check docker logs for progress)"
  fi

  echo ""
  echo "=== Recent Logs (last line per container) ==="
  for name in history_s1 history_s2 history_s3 history_s4 history_s5 history_s6 history_s7; do
    if docker ps -q --filter "name=^${name}$" | grep -q .; then
      echo -n "  $name: "
      docker logs --tail 1 "$name" 2>&1 | grep -oP '\[History\].*' || echo "(no history log yet)"
    fi
  done
}

cmd_logs() {
  local name=${1:-}
  local lines=${2:-50}
  if [ -z "$name" ]; then
    echo "Usage: $0 logs <container_name> [lines]"
    echo "Containers: history_s1 .. history_s7"
    exit 1
  fi
  docker logs --tail "$lines" -f "$name"
}

cmd_restart() {
  local name=${1:-}
  if [ -z "$name" ]; then
    echo "Usage: $0 restart <container_name>"
    exit 1
  fi
  echo "Restarting $name..."
  docker stop "$name" 2>/dev/null || true
  docker rm "$name" 2>/dev/null || true
  start_container "$name"
  echo "Done. Check: docker logs -f $name"
}

# Main
case "${1:-help}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  logs)    cmd_logs "${2:-}" "${3:-50}" ;;
  restart) cmd_restart "${2:-}" ;;
  *)
    echo "Usage: $0 {start|stop|status|logs|restart}"
    echo ""
    echo "Commands:"
    echo "  start              Start all 7 history indexing containers"
    echo "  stop               Stop and remove all containers"
    echo "  status             Show container status and checkpoint progress"
    echo "  logs <name> [N]    Tail N lines of logs for a container"
    echo "  restart <name>     Restart a single container"
    ;;
esac
