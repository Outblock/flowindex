# Flow Scan Clone

A high-performance block explorer for the Flow blockchain, designed to be a reliable alternative to Flowscan.

## 🚀 Mission
When Flowscan is down, we need a community-run, robust explorer that indexes the Flow network in real-time, supporting Cadence contracts and Flow's unique architecture.

## 🛠 Architecture

### Backend (Go)
- **Framework:** Go (using standard `net/http` and `gorilla/mux` or `fib`).
- **Blockchain Access:** Connects to Flow Mainnet via Public RPC / Access API (gRPC or HTTP).
- **Ingestion Engine:**
  - **Block Listener:** Subscribes to new blocks (Block height -> Events -> Transactions).
  - **Historical Indexer:** Batch fetches past blocks for chain replay.
- **Database:** PostgreSQL (Primary storage for indexed data).
- **API:** RESTful API for the frontend and public use.

### Frontend (Bun + Vite + Tailwind)
- **Framework:** React (via Vite).
- **Styling:** Tailwind CSS.
- **Runtime:** Bun (for speed).
- **State Management:** React Query (TanStack Query) for data fetching.

### Database (PostgreSQL)
- **Core Tables:**
  - `blocks`: Indexed block data.
  - `transactions`: Indexed transaction details.
  - `accounts`: Account balances and metadata.
  - `events`: Smart Contract events.
  - `contracts`: Deployed Cadence code.

## 📦 Tech Stack

| Component | Technology |
| :--- | :--- |
| **Backend** | Go 1.21+ |
| **Frontend** | React 18, Vite, Tailwind CSS, Bun |
| **Database** | PostgreSQL 15 |
| **Blockchain Node** | Flow Access Node (gRPC/HTTP) |
| **Indexer** | Custom Go Ingestion Pipeline |

## 🚧 Current Status
- [x] Project Setup (Go module, React app)
- [x] Database Schema Design
- [x] Flow gRPC/HTTP Client Setup
- [x] Block Ingestion Implementation
- [x] API Endpoints
- [x] Frontend Scaffolding

## 📚 Documentation & References
- **Flow Official Repo:** [https://github.com/onflow](https://github.com/onflow)
- **Flow Docs:** [https://developers.flow.com](https://developers.flow.com)
- **Access API:** Needs to handle Blocks, Transactions, Events, and Scripts.
- **Cadence:** We need to support decoding Cadence transactions.

## 🏃‍♂️ Getting Started

### Prerequisites
- Go 1.21+
- Bun 1.0+
- PostgreSQL 15+

### Setup

1. **Clone the repo:**
   ```bash
   git clone https://github.com/yourusername/flowscan-clone.git
   cd flowscan-clone
   ```

2. **Start Database:**
   ```bash
   # Assuming local postgres or docker
   createdb flowscan
   ```

3. **Run Backend:**
   ```bash
   cd backend
   go mod tidy
   go run main.go
   ```

4. **Run Frontend:**
   ```bash
   cd frontend
   bun install
   bun run dev
   ```

## 🤝 Contributing
This is a community effort. Since Flowscan is down, we need to build this **together**.

## 📝 Notes
- We are NOT forking Blockscout. Blockscout is EVM-specific.
- This project is native to Flow (using Flow's data structures, not EVM).
