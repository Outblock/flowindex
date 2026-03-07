#!/bin/bash
# Run Supabase edge-function migrations against the self-hosted PostgreSQL.
# Usage: ./run-migrations.sh
#
# Expects the following env vars (loaded from backend.env on the VM):
#   SUPABASE_DB_URL  — postgres://user:pass@host:port/dbname
#
# Migrations live in supabase/migrations/*.sql and are tracked in
# public.edge_migrations so each file is applied at most once.
set -euo pipefail

MIGRATION_DIR="${1:-$(dirname "$0")/migrations}"

if [ ! -d "$MIGRATION_DIR" ] || ! ls "$MIGRATION_DIR"/*.sql 1>/dev/null 2>&1; then
  echo "No migration files in $MIGRATION_DIR, nothing to do"
  exit 0
fi

# Parse DB credentials from SUPABASE_DB_URL
DB_USER=$(echo "$SUPABASE_DB_URL" | sed -n 's|postgres://\([^:]*\):.*|\1|p')
DB_PASS=$(echo "$SUPABASE_DB_URL" | sed -n 's|postgres://[^:]*:\([^@]*\)@.*|\1|p')
DB_HOST=$(echo "$SUPABASE_DB_URL" | sed -n 's|.*@\([^:/]*\)[:/].*|\1|p')
DB_PORT=$(echo "$SUPABASE_DB_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
DB_NAME=$(echo "$SUPABASE_DB_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')

run_psql() {
  docker run --rm --network=host \
    -e PGPASSWORD="$DB_PASS" \
    postgres:16-alpine \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

# Ensure service_role exists (Supabase migrations may GRANT to it)
run_psql -c "DO \$\$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;"

# Create tracking table
run_psql -c "
  CREATE TABLE IF NOT EXISTS public.edge_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
"

# Apply each migration in filename order
for f in "$MIGRATION_DIR"/*.sql; do
  VERSION=$(basename "$f" .sql)
  ALREADY=$(run_psql -tAc "SELECT 1 FROM public.edge_migrations WHERE version = '$VERSION';" || echo "")
  if [ "$ALREADY" = "1" ]; then
    echo "Skip (already applied): $VERSION"
  else
    echo "Applying: $VERSION"
    docker run --rm --network=host \
      -e PGPASSWORD="$DB_PASS" \
      -v "$f:/tmp/migration.sql:ro" \
      postgres:16-alpine \
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -v ON_ERROR_STOP=0 -f /tmp/migration.sql
    run_psql -c "INSERT INTO public.edge_migrations (version) VALUES ('$VERSION') ON CONFLICT DO NOTHING;"
    echo "Applied: $VERSION"
  fi
done

# Notify PostgREST to reload schema cache (picks up new columns/tables from migrations)
echo "Reloading PostgREST schema cache..."
run_psql -c "NOTIFY pgrst, 'reload schema';" 2>/dev/null || true

echo "All migrations complete"
