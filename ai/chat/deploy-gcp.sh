#!/usr/bin/env bash
set -euo pipefail

# Deploy Vanna SQL to GCP VM
# Usage: ./deploy-gcp.sh
#
# Prerequisites:
#   - gcloud CLI authenticated
#   - Docker installed locally
#   - ANTHROPIC_API_KEY set in environment (or passed via .env)

PROJECT="${GCP_PROJECT:-your-gcp-project}"
ZONE="${GCP_ZONE:-us-west1-a}"
REGION="${GCP_REGION:-us-west1}"
VM_NAME="${VM_NAME:-vanna-sql}"
IMAGE_NAME="vanna-sql"
IMAGE_TAG="latest"
IMAGE_FILE="/tmp/${IMAGE_NAME}.tar.gz"

# Database connection (set via environment or .env file)
DB_URL="${DATABASE_URL:?DATABASE_URL must be set (e.g. postgresql://user:pass@host:5432/dbname)}"

# --- Helpers ---
log() { echo "==> $*"; }
err() { echo "ERROR: $*" >&2; exit 1; }

# --- Check prerequisites ---
command -v gcloud >/dev/null || err "gcloud CLI not found"
command -v docker >/dev/null || err "docker not found"
[[ -n "${ANTHROPIC_API_KEY:-}" ]] || err "ANTHROPIC_API_KEY not set"

# --- Step 1: Create static IP (idempotent) ---
log "Reserving static IP..."
if ! gcloud compute addresses describe vanna-sql-ip \
    --project="$PROJECT" --region="$REGION" &>/dev/null; then
  gcloud compute addresses create vanna-sql-ip \
    --project="$PROJECT" --region="$REGION"
fi

STATIC_IP=$(gcloud compute addresses describe vanna-sql-ip \
  --project="$PROJECT" --region="$REGION" --format='get(address)')
log "Static IP: $STATIC_IP"

# --- Step 2: Create VM (idempotent) ---
log "Creating VM..."
if ! gcloud compute instances describe "$VM_NAME" \
    --project="$PROJECT" --zone="$ZONE" &>/dev/null; then
  gcloud compute instances create "$VM_NAME" \
    --project="$PROJECT" \
    --zone="$ZONE" \
    --machine-type=e2-small \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size=20GB \
    --tags=http-server,https-server \
    --address="$STATIC_IP"
  log "Waiting for VM to boot..."
  sleep 30
fi

# --- Step 3: Firewall rule (idempotent) ---
log "Ensuring firewall rule..."
if ! gcloud compute firewall-rules describe allow-http-https-vanna \
    --project="$PROJECT" &>/dev/null; then
  gcloud compute firewall-rules create allow-http-https-vanna \
    --project="$PROJECT" \
    --allow=tcp:80,tcp:443 \
    --target-tags=http-server,https-server
fi

# --- Step 4: Build Docker image ---
log "Building Docker image..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" "$SCRIPT_DIR"

# --- Step 5: Save and transfer image ---
log "Saving Docker image to $IMAGE_FILE..."
docker save "${IMAGE_NAME}:${IMAGE_TAG}" | gzip > "$IMAGE_FILE"

log "Transferring image to VM (this may take a few minutes)..."
gcloud compute scp "$IMAGE_FILE" "${VM_NAME}:/tmp/${IMAGE_NAME}.tar.gz" \
  --project="$PROJECT" --zone="$ZONE" --tunnel-through-iap

# --- Step 6: Setup VM (Docker, nginx, run container) ---
log "Setting up VM..."
gcloud compute ssh "$VM_NAME" \
  --project="$PROJECT" --zone="$ZONE" --tunnel-through-iap \
  --command="$(cat <<'REMOTE_SCRIPT'
set -euo pipefail

# Install Docker if not present
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io
  sudo usermod -aG docker $USER
fi

# Install nginx if not present
if ! command -v nginx &>/dev/null; then
  echo "Installing nginx..."
  sudo apt-get update
  sudo apt-get install -y nginx
fi

# Load Docker image
echo "Loading Docker image..."
sudo docker load < /tmp/vanna-sql.tar.gz
rm -f /tmp/vanna-sql.tar.gz

# Stop existing container if running
sudo docker rm -f vanna-sql 2>/dev/null || true

echo "VM setup complete."
REMOTE_SCRIPT
)"

# --- Step 7: Copy nginx config and start services ---
log "Copying nginx config..."
gcloud compute scp "${SCRIPT_DIR}/nginx.conf" "${VM_NAME}:/tmp/vanna-nginx.conf" \
  --project="$PROJECT" --zone="$ZONE" --tunnel-through-iap

log "Starting services..."
gcloud compute ssh "$VM_NAME" \
  --project="$PROJECT" --zone="$ZONE" --tunnel-through-iap \
  --command="$(cat <<REMOTE_START
set -euo pipefail

# Configure nginx
sudo cp /tmp/vanna-nginx.conf /etc/nginx/sites-available/vanna
sudo ln -sf /etc/nginx/sites-available/vanna /etc/nginx/sites-enabled/vanna
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Run container
sudo docker run -d \
  --name vanna-sql \
  --restart=unless-stopped \
  -p 8084:8084 \
  -p 3001:3001 \
  -e DATABASE_URL='${DB_URL}' \
  -e ANTHROPIC_API_KEY='${ANTHROPIC_API_KEY}' \
  -e LLM_MODEL='${LLM_MODEL:-claude-sonnet-4-5-20250929}' \
  vanna-sql:latest

echo "Container started. Waiting for health check..."
sleep 10
curl -sf http://localhost:8084/health && echo " Backend healthy!" || echo " Backend not ready yet (may need more time)"
curl -sf http://localhost:3001 >/dev/null && echo "Frontend healthy!" || echo "Frontend not ready yet (may need more time)"
REMOTE_START
)"

# --- Done ---
log ""
log "Deployment complete!"
log "  Public IP:  http://${STATIC_IP}"
log "  Health:     http://${STATIC_IP}/health"
log "  API docs:   http://${STATIC_IP}/docs"
log "  Chat UI:    http://${STATIC_IP}/"
log ""
log "To add SSL after DNS is configured:"
log "  gcloud compute ssh $VM_NAME --project=$PROJECT --zone=$ZONE --tunnel-through-iap"
log "  sudo apt install certbot python3-certbot-nginx"
log "  sudo certbot --nginx -d YOUR_DOMAIN"
