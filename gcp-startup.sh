#!/bin/bash
set -e

# Install Docker
apt-get update
apt-get install -y docker.io
systemctl start docker
systemctl enable docker

# Auth to Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet

# Pull the image
docker pull us-central1-docker.pkg.dev/flow-octopus/flowscan/backend:latest

# Run forward-only ingester from Mainnet 1 (block 7601063)
# Uses a separate checkpoint key (gcp_forward_ingester) to avoid collision with Railway
docker run -d \
  --name flowscan-forward \
  --restart unless-stopped \
  -p 8080:8080 \
  -e DB_URL="postgres://flowscan:secretpassword@34.69.114.28:5432/flowscan" \
  -e DB_MAX_OPEN_CONNS=80 \
  -e DB_MAX_IDLE_CONNS=40 \
  -e DB_SYNCHRONOUS_COMMIT=off \
  -e SKIP_MIGRATION=true \
  -e ENABLE_FORWARD_INGESTER=true \
  -e ENABLE_HISTORY_INGESTER=false \
  -e ENABLE_LIVE_DERIVERS=false \
  -e ENABLE_HISTORY_DERIVERS=false \
  -e ENABLE_TOKEN_WORKER=false \
  -e ENABLE_EVM_WORKER=false \
  -e ENABLE_META_WORKER=false \
  -e ENABLE_ACCOUNTS_WORKER=false \
  -e ENABLE_FT_HOLDINGS_WORKER=false \
  -e ENABLE_NFT_OWNERSHIP_WORKER=false \
  -e ENABLE_TOKEN_METADATA_WORKER=false \
  -e ENABLE_TX_CONTRACTS_WORKER=false \
  -e ENABLE_TX_METRICS_WORKER=false \
  -e ENABLE_STAKING_WORKER=false \
  -e ENABLE_DEFI_WORKER=false \
  -e ENABLE_DAILY_BALANCE_WORKER=false \
  -e ENABLE_NFT_ITEM_METADATA_WORKER=false \
  -e ENABLE_SCHEDULED_TX_WORKER=false \
  -e ENABLE_NETWORK_POLLER=false \
  -e FORWARD_SERVICE_NAME=gcp_forward_ingester \
  -e FLOW_ACCESS_NODE="access-001.mainnet28.nodes.onflow.org:9000" \
  -e FLOW_ACCESS_NODES="access-001.mainnet28.nodes.onflow.org:9000,access-002.mainnet28.nodes.onflow.org:9000,access-003.mainnet28.nodes.onflow.org:9000,access-004.mainnet28.nodes.onflow.org:9000" \
  -e FLOW_HISTORIC_ACCESS_NODES="access.mainnet.nodes.onflow.org:9000,access-001.mainnet28.nodes.onflow.org:9000,access-002.mainnet28.nodes.onflow.org:9000,access-001.mainnet27.nodes.onflow.org:9000,access-001.mainnet26.nodes.onflow.org:9000,access-001.mainnet25.nodes.onflow.org:9000,access-001.mainnet24.nodes.onflow.org:9000,access-001.mainnet23.nodes.onflow.org:9000,access-001.mainnet22.nodes.onflow.org:9000,access-001.mainnet21.nodes.onflow.org:9000,access-001.mainnet20.nodes.onflow.org:9000,access-001.mainnet19.nodes.onflow.org:9000,access-001.mainnet18.nodes.onflow.org:9000,access-001.mainnet17.nodes.onflow.org:9000,access-001.mainnet16.nodes.onflow.org:9000,access-001.mainnet15.nodes.onflow.org:9000,access-001.mainnet14.nodes.onflow.org:9000,access-001.mainnet13.nodes.onflow.org:9000,access-001.mainnet12.nodes.onflow.org:9000,access-001.mainnet11.nodes.onflow.org:9000,access-001.mainnet10.nodes.onflow.org:9000,access-001.mainnet9.nodes.onflow.org:9000,access-001.mainnet8.nodes.onflow.org:9000,access-001.mainnet7.nodes.onflow.org:9000,access-001.mainnet6.nodes.onflow.org:9000,access-001.mainnet5.nodes.onflow.org:9000,access-001.mainnet4.nodes.onflow.org:9000,access-001.mainnet3.nodes.onflow.org:9000,access-001.mainnet2.nodes.onflow.org:9000,access-001.mainnet1.nodes.onflow.org:9000" \
  -e FLOW_RPC_RPS=10000 \
  -e FLOW_RPC_BURST=20000 \
  -e FLOW_RPC_RPS_PER_NODE=2000 \
  -e FLOW_RPC_BURST_PER_NODE=4000 \
  -e LATEST_WORKER_COUNT=400 \
  -e LATEST_BATCH_SIZE=5000 \
  -e START_BLOCK=7601063 \
  -e PORT=8080 \
  us-central1-docker.pkg.dev/flow-octopus/flowscan/backend:latest

echo "Forward ingester started from Mainnet 1 (block 7601063)!"
