# FlowScan Clone - 项目状态报告

**更新时间:** 2026-02-03

---

## 项目概览

**目标:** 构建面向 Flow 区块链的浏览器（类似 etherscan / blockscout），支持高性能索引、查询与可视化。

**技术栈:**
- **Backend:** Go + PostgreSQL + Gorilla WebSocket
- **Frontend:** React + Vite + TailwindCSS
- **链:** Flow Blockchain

---

## 当前架构（摘要）

- **Ingesters**: Forward/Backward 并发抓取区块数据
- **Raw 存储**: `raw.*` 分区表保存区块/交易/事件
- **Lookup 表**: `raw.tx_lookup` / `raw.block_lookup` 加速 ID 查询
- **Async Workers**: Token/Meta Worker 从 raw 生成 `app.*` 派生表
- **API**: REST + WebSocket，支持 cursor 分页
- **Frontend**: 首页/区块/交易/账户页；账户页 Token/NFT 使用 cursor API

---

## 已完成

### Backend / 数据层
- **Schema V2** 完成：`raw.` / `app.` 逻辑分离 + 分区表
- **Lookup 表**：`raw.tx_lookup` / `raw.block_lookup` 加速 ID 查询
- **Partition 管理**：写入时按需创建分区
- **重组回滚**：`MAX_REORG_DEPTH` + 回滚逻辑
- **RPC 限速**：`FLOW_RPC_RPS` / `FLOW_RPC_BURST`
- **Lookup Repair**：可选后台修复任务

### Backend / Worker
- **TokenWorker**：JSON-CDC 解析可用，写入 `app.token_transfers`
- **MetaWorker**：地址交易、keys、合约与统计写入
- **Committer**：连续 checkpoint 推进

### API
- **Cursor API**：
  - `/blocks?cursor=height`
  - `/transactions?cursor=block:tx_index:tx_id`
  - `/accounts/:address/transactions?cursor=block:tx_id`
  - `/accounts/:address/token-transfers?cursor=block:tx_id:event_index`
  - `/accounts/:address/nft-transfers?cursor=block:tx_id:event_index`

### Frontend
- 账户页新增 **Transactions / Tokens / NFTs** Tab
- Token/NFT 列表接入 cursor API（Load More）

### 文档与部署
- `RAILWAY_RUNBOOK.md`：Railway 验证流程
- `RAILWAY_ENV.example`：Railway 环境变量模板
- `DEPLOY_ENV.md`：最终发布环境变量清单

---

## 进行中 / 待办

- **EVM Worker**：写入 `app.evm_transactions`
- **Token/NFT 独立页面**：全局列表/详情页
- **统计任务**：Daily Stats 与可视化完善
- **Dev Proxy**：Vite 本地开发缺少 `/api` 代理（建议加 proxy 或使用 nginx frontend）
- **物理拆分**：raw/app 数据库拆分（Phase 2）

---

## 已知问题 / 注意事项

- **`schema.sql` 已过时**，当前使用 `backend/schema_v2.sql`。
- **派生写入默认关闭**：
  - `ENABLE_DERIVED_WRITES=false` 时不写 `app.*` 派生表
  - 需要启用 `ENABLE_TOKEN_WORKER` / `ENABLE_META_WORKER`
- **前端端口 5173**
  - Vite dev server 未配置 `/api` 代理，直接运行 `npm run dev` 将无法访问后端
  - Docker nginx 前端需要正确映射到 8080（compose 目前映射为 `5173:80`）

---

## 关键文档

- `ARCHITECTURE.md`：当前架构 + 图
- `DEPLOY_ENV.md`：环境变量清单
- `RAILWAY_RUNBOOK.md`：Railway 验证流程

---

## 简要启动（Docker）

```bash
docker compose up -d --build
```

- Backend: `http://localhost:8080`
- Frontend: `http://localhost:5173`（如映射修正为 5173:8080）

---

## 状态总结

**完成度:** ~85%

**核心能力已具备:**
- Raw 数据高性能索引
- 可扩展的派生 Worker 架构
- Cursor 分页 API
- 关键页面可用（Block/Tx/Account + Token/NFT 列表）

**下一步方向清晰:**
- EVM/统计/Token-NFT 全局页
- 迁移与扩容至 GCP

