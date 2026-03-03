# Sim Studio

Self-hosted [Sim Studio](https://github.com/simstudioai/sim) deployment.

Runs on the backend VM (`flowindex-backend`) using the official `simstudioai/sim` Docker image.

## Architecture

- **Port 3200**: Web application
- **Port 3202**: WebSocket server
- **Database**: `simstudio` database on the shared Cloud SQL instance
- **URL**: https://studio.flowindex.io
- **Reverse proxy**: Caddy on the frontend VM routes `studio.flowindex.io` to the backend VM

## Manual Deploy

```bash
gh workflow run deploy.yml -f services=sim-studio
```

## Environment

Secrets are auto-generated on first deploy and stored at `/mnt/stateful_partition/pgdata/sim-studio.env` on the backend VM.
