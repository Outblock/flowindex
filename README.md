# FlowScan Clone

A modern, high-performance explorer for the Flow Blockchain, featuring rapid block ingestion, Flow-EVM support, and rich visual dashboards.

## Features

-   **High-Performance Indexing**: Configurable "Forward" (Live) and "Backward" (History) ingestors with concurrent workers.
-   **Flow-EVM Support**: First-class support for EVM transactions within Flow.
-   **Modern UI**: "Nothing Phone" inspired aesthetics using React + TailwindCSS + Shadcn/UI.
-   **Real-time Updates**: Live blocks and transactions via WebSocket (mocked/polled).
-   **Deployment Ready**: Fully containerized (Docker) and Railway-compatible monorepo.

## Project Structure

-   `backend/`: Go (Golang) Indexer & API Service.
    -   Uses `pgx` for high-performance PostgreSQL interactions.
    -   `internal/ingester`: Concurrent block processing pipeline.
-   `frontend/`: React (Vite) + TailwindCSS.
    -   `src/pages`: Block, Transaction, Account, Home views.

## Deployment (Railway)

This project is configured for one-click deployment on Railway using the Root Build Context strategy.

1.  **Connect GitHub**: Link this repo to Railway.
2.  **Services**:
    -   **Backend**: `Dockerfile` is in `backend/` but built from Root.
    -   **Frontend**: `Dockerfile` is in `frontend/` but built from Root.
3.  **Variables**: configuration is handled via `railway.toml`.

## Local Development

### Prerequisites
-   Docker & Docker Compose
-   Go 1.24+
-   Node.js 20+

### Run Locally
```bash
docker-compose up -d --build
```
Access Frontend at `http://localhost:5173` (or port defined in compose).
Access Backend API at `http://localhost:8080`.

## License
MIT
