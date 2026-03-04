#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-flowindex-mainnet}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
BACKEND_VM="${BACKEND_VM:-flowindex-backend}"
REGISTRY="${REGISTRY:-${REGION}-docker.pkg.dev/${PROJECT_ID}/flowindex}"

IMAGE_TAG="${IMAGE_TAG:-latest}"
BUILD_IMAGES="false"

usage() {
  cat <<'EOF'
Deploy Sim Studio from local machine (without GitHub Actions).

Usage:
  scripts/deploy-sim-studio-local.sh [--tag <tag>] [--build]

Options:
  --tag <tag>   Image tag to deploy (default: latest)
  --build       Build + push sim-workflow images before deploying
  -h, --help    Show this help

Env overrides:
  PROJECT_ID, REGION, ZONE, BACKEND_VM, REGISTRY, IMAGE_TAG
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      IMAGE_TAG="${2:-}"
      if [[ -z "${IMAGE_TAG}" ]]; then
        echo "Missing value for --tag"
        exit 1
      fi
      shift 2
      ;;
    --build)
      BUILD_IMAGES="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1"
    exit 1
  fi
}

require_cmd gcloud
require_cmd docker

SIM_STUDIO_IMAGE="${REGISTRY}/simstudio-fork:${IMAGE_TAG}"
SIM_STUDIO_REALTIME_IMAGE="${REGISTRY}/simstudio-fork-realtime:${IMAGE_TAG}"
SIM_STUDIO_MIGRATIONS_IMAGE="${REGISTRY}/simstudio-fork-migrations:${IMAGE_TAG}"

echo "Project: ${PROJECT_ID}"
echo "Zone: ${ZONE}"
echo "Backend VM: ${BACKEND_VM}"
echo "Registry: ${REGISTRY}"
echo "Tag: ${IMAGE_TAG}"

gcloud config set project "${PROJECT_ID}" >/dev/null

if [[ "${BUILD_IMAGES}" == "true" ]]; then
  echo "Configuring Docker auth for Artifact Registry..."
  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

  echo "Building and pushing simstudio-fork app image..."
  docker buildx build \
    --platform linux/amd64 \
    -f sim-workflow/docker/app.Dockerfile \
    -t "${SIM_STUDIO_IMAGE}" \
    --push \
    sim-workflow

  echo "Building and pushing simstudio-fork realtime image..."
  docker buildx build \
    --platform linux/amd64 \
    -f sim-workflow/docker/realtime.Dockerfile \
    -t "${SIM_STUDIO_REALTIME_IMAGE}" \
    --push \
    sim-workflow

  echo "Building and pushing simstudio-fork migrations image..."
  docker buildx build \
    --platform linux/amd64 \
    -f sim-workflow/docker/db.Dockerfile \
    -t "${SIM_STUDIO_MIGRATIONS_IMAGE}" \
    --push \
    sim-workflow
fi

echo "Uploading seed SQL to backend VM..."
gcloud compute scp studio/seed/simstudio_seed.sql "${BACKEND_VM}:~/simstudio_seed.sql" --zone="${ZONE}"

REMOTE_SCRIPT="$(mktemp)"
cat > "${REMOTE_SCRIPT}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

load_env() {
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$line" ]] && continue
    export "$line" 2>/dev/null || true
  done < "$1"
}

load_env /mnt/stateful_partition/pgdata/backend.env

SIM_ENV=/mnt/stateful_partition/pgdata/sim-studio.env
if [ ! -f "$SIM_ENV" ]; then
  cat > "$SIM_ENV" << ENVEOF
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
INTERNAL_API_SECRET=$(openssl rand -hex 32)
SIM_STUDIO_IMAGE=us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simstudio-fork:latest
SIM_STUDIO_REALTIME_IMAGE=us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simstudio-fork-realtime:latest
SIM_STUDIO_MIGRATIONS_IMAGE=us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simstudio-fork-migrations:latest
FLOWINDEX_AUTH_MODE=supabase_cookie
ENVEOF
  echo "Created $SIM_ENV with generated secrets"
fi
load_env "$SIM_ENV"

SIM_STUDIO_IMAGE="${SIM_STUDIO_IMAGE_OVERRIDE:-${SIM_STUDIO_IMAGE:-us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simstudio-fork:latest}}"
SIM_STUDIO_REALTIME_IMAGE="${SIM_STUDIO_REALTIME_IMAGE_OVERRIDE:-${SIM_STUDIO_REALTIME_IMAGE:-us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simstudio-fork-realtime:latest}}"
SIM_STUDIO_MIGRATIONS_IMAGE="${SIM_STUDIO_MIGRATIONS_IMAGE_OVERRIDE:-${SIM_STUDIO_MIGRATIONS_IMAGE:-us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simstudio-fork-migrations:latest}}"
FLOWINDEX_AUTH_MODE="${FLOWINDEX_AUTH_MODE:-supabase_cookie}"

SOURCE_SIM_DB_URL="${SOURCE_SIM_DB_URL:-$SUPABASE_DB_URL}"
DB_USER=$(echo "$SOURCE_SIM_DB_URL" | sed -n "s|.*://\([^:]*\):.*|\1|p")
DB_PASS=$(echo "$SOURCE_SIM_DB_URL" | sed -n "s|.*://[^:]*:\([^@]*\)@.*|\1|p")
DB_HOST=$(echo "$SOURCE_SIM_DB_URL" | sed -n "s|.*://[^:]*:[^@]*@\([^:/?]*\).*|\1|p")
DB_PORT=$(echo "$SOURCE_SIM_DB_URL" | sed -n "s|.*://[^:]*:[^@]*@[^:/?]*:\([0-9]*\).*|\1|p")
SIM_DB_NAME=$(echo "$SOURCE_SIM_DB_URL" | sed -n "s|.*/\([^?]*\).*|\1|p")

if [ -z "$DB_PORT" ]; then DB_PORT=5432; fi
if [ -z "$SIM_DB_NAME" ]; then
  echo "Failed to parse database name from SOURCE_SIM_DB_URL"
  exit 1
fi
SIM_DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${SIM_DB_NAME}"

run_psql() {
  docker run --rm --network=host \
    -e PGPASSWORD="$DB_PASS" \
    postgres:16-alpine \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$@"
}

VECTOR_SCHEMA=$(run_psql -d "$SIM_DB_NAME" -tAc "SELECT n.nspname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname=\$\$vector\$\$ LIMIT 1;" | tr -d '[:space:]')
if [ -z "$VECTOR_SCHEMA" ]; then
  run_psql -d "$SIM_DB_NAME" -c "CREATE SCHEMA IF NOT EXISTS extensions;"
  run_psql -d "$SIM_DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;"
  VECTOR_SCHEMA=$(run_psql -d "$SIM_DB_NAME" -tAc "SELECT n.nspname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname=\$\$vector\$\$ LIMIT 1;" | tr -d '[:space:]')
fi
if [ -z "$VECTOR_SCHEMA" ]; then
  echo "pgvector type 'vector' is unavailable in database $SIM_DB_NAME"
  exit 1
fi
if ! echo "$VECTOR_SCHEMA" | grep -Eq "^[A-Za-z_][A-Za-z0-9_]*$"; then
  echo "Unsafe vector schema name: $VECTOR_SCHEMA"
  exit 1
fi

if [ "$VECTOR_SCHEMA" = "simstudio" ] || [ "$VECTOR_SCHEMA" = "public" ]; then
  SIM_SEARCH_PATH="simstudio,public"
else
  SIM_SEARCH_PATH="simstudio,public,${VECTOR_SCHEMA}"
fi
ENCODED_SIM_SEARCH_PATH=$(printf "%s" "$SIM_SEARCH_PATH" | sed "s/,/%2C/g")
SIM_MIGRATION_DB_URL="${SIM_DB_URL}?options=-csearch_path%3D${ENCODED_SIM_SEARCH_PATH}"

run_psql -d postgres -c "ALTER DATABASE \"$SIM_DB_NAME\" SET search_path TO ${SIM_SEARCH_PATH}"
run_psql -d "$SIM_DB_NAME" -c "ALTER ROLE \"$DB_USER\" IN DATABASE \"$SIM_DB_NAME\" SET search_path TO ${SIM_SEARCH_PATH}"

SEARCH_PATH=$(run_psql -d "$SIM_DB_NAME" -tAc "SHOW search_path;" | tr -d '\r')
echo "DB search_path: ${SEARCH_PATH:-unknown}"
echo "vector type schema: $VECTOR_SCHEMA"
run_psql -d "$SIM_DB_NAME" -v ON_ERROR_STOP=1 -c "SET search_path TO ${SIM_SEARCH_PATH}; SELECT NULL::vector;"
echo "Database $SIM_DB_NAME ready"

docker pull "$SIM_STUDIO_IMAGE"
docker pull "$SIM_STUDIO_REALTIME_IMAGE"
docker pull "$SIM_STUDIO_MIGRATIONS_IMAGE"

echo "Running Sim Studio Drizzle migrations..."
docker run --rm --network=host \
  -e DATABASE_URL="$SIM_MIGRATION_DB_URL" \
  -e PGOPTIONS="-c search_path=${SIM_SEARCH_PATH}" \
  "$SIM_STUDIO_MIGRATIONS_IMAGE" \
  run db:migrate
echo "Migrations applied"

echo "Applying Sim Studio startup seed..."
docker run --rm --network=host -i \
  -e PGPASSWORD="$DB_PASS" \
  postgres:16-alpine \
  psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$SIM_DB_NAME" \
  < ~/simstudio_seed.sql
echo "Seed applied"

USER_TABLE_OK=$(run_psql -d "$SIM_DB_NAME" -tAc "SELECT to_regclass(\$\$simstudio.\"user\"\$\$) IS NOT NULL;" | tr -d "[:space:]")
SESSION_TABLE_OK=$(run_psql -d "$SIM_DB_NAME" -tAc "SELECT to_regclass(\$\$simstudio.session\$\$) IS NOT NULL;" | tr -d "[:space:]")
USER_STATS_TABLE_OK=$(run_psql -d "$SIM_DB_NAME" -tAc "SELECT to_regclass(\$\$simstudio.user_stats\$\$) IS NOT NULL;" | tr -d "[:space:]")
if [ "$USER_TABLE_OK" != "t" ] || [ "$SESSION_TABLE_OK" != "t" ] || [ "$USER_STATS_TABLE_OK" != "t" ]; then
  echo "Required Sim Studio auth tables missing (user/session/user_stats); aborting deploy"
  exit 1
fi

docker stop sim-studio sim-studio-realtime sim-studio-auth 2>/dev/null || true
docker rm sim-studio sim-studio-realtime sim-studio-auth 2>/dev/null || true

docker run -d --restart=always --name sim-studio \
  --network=host \
  -e NODE_ENV=production \
  -e DATABASE_URL="$SIM_DB_URL" \
  -e BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}" \
  -e BETTER_AUTH_URL="https://studio.flowindex.io" \
  -e ENCRYPTION_KEY="${ENCRYPTION_KEY}" \
  -e INTERNAL_API_SECRET="${INTERNAL_API_SECRET}" \
  -e SUPABASE_URL="${VITE_SUPABASE_URL}" \
  -e SUPABASE_JWT_SECRET="${SUPABASE_JWT_SECRET}" \
  -e FLOWINDEX_AUTH_MODE="${FLOWINDEX_AUTH_MODE}" \
  -e NEXT_PUBLIC_APP_URL="https://studio.flowindex.io" \
  -e NEXT_PUBLIC_SOCKET_URL="https://studio.flowindex.io" \
  -e SOCKET_SERVER_URL="http://127.0.0.1:3202" \
  -e CRON_SECRET="${CRON_SECRET}" \
  -e PORT=3200 \
  "$SIM_STUDIO_IMAGE"

docker run -d --restart=always --name sim-studio-realtime \
  --network=host \
  -e NODE_ENV=production \
  -e DATABASE_URL="$SIM_DB_URL" \
  -e BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}" \
  -e BETTER_AUTH_URL="https://studio.flowindex.io" \
  -e PORT=3202 \
  -e INTERNAL_API_SECRET="${INTERNAL_API_SECRET}" \
  -e FLOWINDEX_AUTH_MODE="${FLOWINDEX_AUTH_MODE}" \
  -e SUPABASE_JWT_SECRET="${SUPABASE_JWT_SECRET}" \
  -e NEXT_PUBLIC_APP_URL="https://studio.flowindex.io" \
  -e NEXT_PUBLIC_SOCKET_URL="https://studio.flowindex.io" \
  "$SIM_STUDIO_REALTIME_IMAGE"

echo "Sim Studio deployed (web: 3200, realtime: 3202)"
docker ps --filter name=sim-studio --format "table {{.Names}}\t{{.Status}}"
EOF

chmod +x "${REMOTE_SCRIPT}"
gcloud compute scp "${REMOTE_SCRIPT}" "${BACKEND_VM}:~/deploy-sim-studio-local.sh" --zone="${ZONE}"
rm -f "${REMOTE_SCRIPT}"

echo "Running remote deploy script..."
gcloud compute ssh "${BACKEND_VM}" --zone="${ZONE}" --command "\
SIM_STUDIO_IMAGE_OVERRIDE='${SIM_STUDIO_IMAGE}' \
SIM_STUDIO_REALTIME_IMAGE_OVERRIDE='${SIM_STUDIO_REALTIME_IMAGE}' \
SIM_STUDIO_MIGRATIONS_IMAGE_OVERRIDE='${SIM_STUDIO_MIGRATIONS_IMAGE}' \
bash ~/deploy-sim-studio-local.sh"

echo "Done."
