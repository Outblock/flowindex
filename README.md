# FlowScan Clone

Flow 区块链浏览器（类似 etherscan / blockscout），聚焦高性能索引、可扩展存储与低延迟查询。

## Features
- **Schema V2**: `raw.*` / `app.*` 分层 + 分区表
- **Forward/Backward Ingesters**: 并行抓取最新与历史
- **Async Workers**: Token/Meta 派生数据异步生成
- **Cursor Pagination**: Blocks / Transactions / Address / Token / NFT
- **REST + WebSocket**: 实时区块与交易推送
- **Railway & Docker**: 可快速验证与部署

## Docs
- `ARCHITECTURE.md`：架构与流程图
- `DEPLOY_ENV.md`：最终发布环境变量清单
- `RAILWAY_RUNBOOK.md`：Railway 验证流程
- `PROJECT_STATUS.md`：当前状态与待办

## Project Structure
- `backend/`: Go Indexer + API
- `frontend/`: React (Vite) UI
- `docker-compose.yml`: 本地一键启动

## Local Development

### Prerequisites
- Docker & Docker Compose
- Go 1.24+
- Node.js 20+ (或 Bun)

### Run via Docker (recommended)
```bash
docker compose up -d --build
```
- Backend: `http://localhost:8080`
- Frontend: `http://localhost:5173`

### Run Backend (dev)
```bash
cd backend
export DB_URL="postgres://flowscan:secretpassword@localhost:5432/flowscan?sslmode=disable"
export FLOW_ACCESS_NODE="access-001.mainnet28.nodes.onflow.org:9000"
go run main.go
```

### Run Frontend (dev)
```bash
cd frontend
npm install
npm run dev
```

## Deployment (Railway)
- Railway 通过 Root Build Context 部署
- 环境变量模板参考 `RAILWAY_ENV.example`
- 详细步骤见 `RAILWAY_RUNBOOK.md`

