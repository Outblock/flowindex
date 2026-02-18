# FlowScan 历史数据回填 — 问题总结与瓶颈分析

> 更新时间：2026-02-18

## 一、背景

FlowScan 需要索引 Flow 区块链从创世到现在的所有历史数据。Flow 采用 **Spork 机制**（类似硬分叉），每次 Spork 升级后旧数据只能通过对应 Spork 的 Access Node 查询。目前共有 28 个 Mainnet Spork + 6 个 Candidate Spork（pre-mainnet）。

当前在 GCP VM（e2-standard-16, 16 vCPU / 64GB）上运行 6 个并行容器（S1-S6），每个负责不同的 Spork 高度范围，从高往低倒序回填。

---

## 二、Flow 区块链数据可达性

### 完整的 Spork 列表与节点状态

数据来源：[官方 sporks.json](https://github.com/onflow/flow/blob/master/sporks.json)

| 阶段 | Root Height | Access Node | 状态 |
|------|------------|-------------|------|
| Block 0 ~ 1,065,710 | — | 无 | **永久不可达** — 无任何公开节点 |
| Candidate-1/2/3 | 未知 | 未知 | **不在 sporks.json 中**，无记录 |
| Candidate-4 | 1,065,711 | access-001.candidate4.nodes.onflow.org:9000 | **API 不兼容** — `unknown service flow.access.AccessAPI` |
| Candidate-5 | 2,033,592 | access-001.candidate5.nodes.onflow.org:9000 | **API 不兼容** — 同上 |
| Candidate-6 | 3,187,931 | access-001.candidate6.nodes.onflow.org:9000 | **API 不兼容** — 同上 |
| **Candidate-7** | **4,132,133** | access-001.candidate7.nodes.onflow.org:9000 | ✅ 可用（快速，~200ms） |
| **Candidate-8** | **4,972,987** | access-001.candidate8.nodes.onflow.org:9000 | ✅ 可用（快速，~200ms） |
| **Candidate-9** | **6,483,246** | access-001.candidate9.nodes.onflow.org:9000 | ✅ 可用（快速，~200ms） |
| **Mainnet-1** | **7,601,063** | access-001.mainnet1.nodes.onflow.org:9000 | ✅ 可用 |
| Mainnet-2 | 8,742,959 | access-001.mainnet2.nodes.onflow.org:9000 | ✅ 可用 |
| Mainnet-3 | 9,737,133 | access-001.mainnet3.nodes.onflow.org:9000 | ✅ 可用 |
| Mainnet-4 | 9,992,020 | access-001.mainnet4.nodes.onflow.org:9000 | ⚠️ 不稳定 — DNS 间歇失败 |
| Mainnet-5 ~ 16 | 12,020,337 ~ 23,830,813 | access-001.mainnetN.nodes.onflow.org:9000 | ✅ 可用 |
| **Mainnet-17** | 27,341,470 | access-001.mainnet17.nodes.onflow.org:9000 | ✅ 可用（有 002-010 备用节点） |
| Mainnet-18 ~ 20 | 31,735,955 ~ 40,171,634 | access-001.mainnetN.nodes.onflow.org:9000 | ✅ 可用 |
| **Mainnet-21** | **44,950,207** | access-001.mainnet21.nodes.onflow.org:9000 | ⚠️ **极慢** — GetBlockByHeight 可达 57s |
| Mainnet-22 | 47,169,687 | access-001.mainnet22.nodes.onflow.org:9000 | ✅ 可用 |
| **Mainnet-23** | **55,114,467** | access-001.mainnet23.nodes.onflow.org:9000 | ⚠️ **极慢** — GetBlockByHeight 可达 83s |
| Mainnet-24 | 65,264,619 | access-001.mainnet24.nodes.onflow.org:9000 | ✅ 可用（中速，~3-9s/RPC） |
| Mainnet-25 ~ 28 | 85,981,135 ~ 137,390,146 | access-001.mainnetN.nodes.onflow.org:9000 | ✅ 可用 |

### 关键结论

- **可索引范围**：Block 4,132,133（Candidate-7）→ 现在（~139M），约 **1.35 亿块**
- **永久不可达**：Block 0 → 4,132,132（约 413 万块）
  - Candidate 4-6 节点在线，但运行的是太老的 gRPC 协议，不支持 `flow.access.AccessAPI` 标准接口
  - Candidate 1-3 完全没有公开记录
  - Flowscan.io 等早期项目能展示这些数据，是因为它们在当年协议兼容时已经索引过
- **每个 Spork 节点只能查自己 root height 以上的区块**，不能跨 Spork 向下查询（已实测确认）
- **新 Spork 节点不能查旧 Spork 数据**（mainnet25/26/28 均返回 NotFound，已实测确认）

---

## 三、API 能力差异（按 Spork 版本）

| 能力 | Spork 1-17 (v0.12~v0.25) | Spork 18+ (v0.26+) |
|------|--------------------------|---------------------|
| GetBlockByHeight | ✅ | ✅ |
| GetCollection | ✅ | ✅ |
| GetTransaction (单个) | ✅ | ✅ |
| GetTransactionResult (单个) | ✅ | ✅ |
| **GetTransactionsByBlockID (批量)** | ❌ Unimplemented | ✅ |
| **GetTransactionResultsByBlockID (批量)** | ❌ Unimplemented | ✅ |
| GetEventsForBlockIDs (按类型) | ✅（必须指定事件类型） | ✅ |
| GetEventsForBlockIDs (全部事件，空类型) | ❌ InvalidArgument | ❌ InvalidArgument |

### 对索引的影响

**Spork 1-17（无批量 API）**：
```
每个 Block 需要的 RPC 调用数 = 1(block) + C(collections) + N(transactions) + N(tx results)
典型值：1 + 3 + 3 + 3 = 10 次 RPC
```

**Spork 18+（有批量 API）**：
```
每个 Block 只需 3 次 RPC = 1(block) + 1(bulk txs) + 1(bulk results)
```

---

## 四、RPC 节点性能瓶颈（核心问题）

### 实测延迟数据

以下是从本地直接调用各 Spork 节点的**单次 RPC 延迟**（非并发，暖缓存）：

| Spork | 测试高度 | GetBlockByHeight | GetCollection | 批量 Results | 单个 Result | 5块平均 |
|-------|---------|-----------------|---------------|-------------|------------|---------|
| **14** | 20M | **1.2s** | 300ms | N/A (不支持) | 0.4-2s | **361ms** |
| **15** | 22M | **2.1s** | 240ms | N/A (不支持) | 0.4-1.7s | **506ms** |
| **21** | 46M | **57.6s** ⚠️ | 3.4s | 18.1s | 6-11s | **9.9s** |
| **23** | 60M | **82.8s** ⚠️ | 2.7s | 5.1s | 3-4s | **8.8s** |
| **24** | 80M | **9.2s** | 500ms | 3.0s | 1.4-3.7s | **3.75s** |

### 冷缓存 vs 暖缓存

Spork 节点有显著的**冷缓存效应**：

| 节点 | 冷缓存首次 | 暖缓存后续 | 差异倍数 |
|------|-----------|-----------|---------|
| Spork 21 | 57.6s | 3.8s | **15x** |
| Spork 23 | 82.8s | 0.6s | **138x** |
| Spork 24 | 9.2s | ~2s | **4.6x** |

暖缓存后连续 10 块测试：
- **Spork 23 暖缓存**：每块 5-20s（平均 ~12s），波动极大
- **Spork 14 暖缓存**：每块 1.4-6s（平均 ~3.4s），相对稳定

### 节点可用性

| 检查项 | 结果 |
|--------|------|
| 大多数 Spork 是否有备用节点（access-002） | ❌ 连接超时，只有 access-001 可用 |
| Mainnet-17 是否有多节点 | ✅ 有 002-010，但仅限 spork 17 |
| 新 Spork 节点能否查旧数据 | ❌ 每个节点只能查自己 Spork 范围 |
| Archive Node 能否查所有历史 | ❌ 只能查当前 Spork 以内 |

### 结论

**瓶颈在 RPC 节点本身，不是我们的代码。**

- Spork 21 和 23 的节点响应极慢，即使只是查一个 Block Header 也要数秒到数十秒
- 50 个并发 Worker 全部打到同一个 Spork 节点上，节点吞吐有限
- 没有替代节点可用（大多数 Spork 只有 access-001 一个节点）
- 这是 Flow 基础设施的限制，无法从我们的代码层面解决
- 我们的代码对于有批量 API 的 Spork 已经做到了最少 RPC 调用（3 次/块）

---

## 五、代码层面已遇到的问题与修复

### 5.1 Cadence SDK Panic（已修复）

**问题**：Spork 23-24 的事件 payload 包含老版本 Cadence 类型（如 `RestrictedType`），Flow SDK 在解码时会 panic（不是 error，是 Go panic）。

**修复**：
- 设置 `CrescendoHeight = 88,226,267`（Spork 26 root）
- 低于此高度的块使用 Raw gRPC + `JSON_CDC_V0` 编码绕过 SDK 解码器
- 实现了 `GetTransactionResultRaw()` 和 `GetTransactionResultsByBlockIDRaw()`

### 5.2 CCF Decode Error（已修复）

**问题**：批量 API `GetTransactionResultsByBlockID` 返回 CCF 编码的结果，SDK 无法解码：
```
ccf: failed to decode: unexpected CBOR type CBOR boolean type as Authorization type
```
导致块被直接跳过（~4% 的块），不会触发 fallback。

**修复**：添加 `isCCFDecodeError()` 检测，触发 fallback 到 per-tx 或 raw gRPC 调用。

### 5.3 Unicode Null Byte（已修复）

**问题**：老 Spork（约 spork 10-15）的交易脚本/参数包含 `\u0000`（null byte），PostgreSQL 的 text/JSONB 列拒绝存储：
```
ERROR: unsupported Unicode escape sequence (SQLSTATE 22P05)
```
导致 S3 容器卡在 height 23,684,812，反复重试同一批次。

**修复**：添加 `sanitizeNull()` 函数，在写入 DB 前清除字符串中的 null byte。应用到 `scriptInline`、`Arguments`、`ErrorMessage` 和事件 `Payload`。

### 5.4 Spork Root Heights 错误（已修复）

**问题**：代码中 Spork 23-27 的 root height 值是错的（之前的值不知来源），导致块被路由到错误的节点，请求失败或数据不对。

**修复**：对照 [sporks.json](https://github.com/onflow/flow/blob/master/sporks.json) 修正了所有值。修正前后对比：

| Spork | 修正前 | 修正后 (正确值) |
|-------|--------|----------------|
| 23 | 47,194,634 | **55,114,467** |
| 24 | 53,376,277 | **65,264,619** |
| 25 | 55,114,467 | **85,981,135** |
| 26 | 65,264,629 | **88,226,267** |
| 27 | 85,981,135 | **130,290,659** |

### 5.5 Migration 死锁（已修复）

**问题**：6 个容器同时启动时都尝试执行 DDL schema migration，导致 PostgreSQL 死锁：
```
ERROR: tuple concurrently updated
```
所有容器卡在 "Running Database Migration"。

**修复**：添加 `SKIP_MIGRATION=true` 环境变量跳过迁移（schema 已经是最新的）。

### 5.6 Live Deriver 冲突（已修复）

**问题**：6 个容器全都启动了 live_deriver workers，导致：
- 死锁（多容器竞争同一 worker 队列）
- 缺表错误（`app.staking_events` 不存在）
- 缺列错误（`evm_address` on `nft_collections`）

**修复**：使用 `RAW_ONLY=true` 模式，只运行 ingester，禁用所有 workers/derivers/pollers。

### 5.7 Worker Lease 积累（已修复）

**问题**：崩溃的容器留下大量 `attempt >= 21` 的死 worker lease，阻塞 checkpoint 推进。S1 因此无法前进。

**修复**：监控脚本自动清理死 lease：
```sql
DELETE FROM app.worker_leases WHERE attempt >= 21;
```

### 5.8 容器 Checkpoint 名称冲突（已修复）

**问题**：所有容器默认使用 `history_ingester` 作为 checkpoint key，导致互相覆盖。重启后从链头（139M）开始而不是各自的历史位置。

**表现**：容器 S3 在重启后显示 `[History] Backfilling range 139217999 -> 139216000`，试图用 mainnet10 节点查 139M 的块（必然失败）。

**修复**：通过 `HISTORY_SERVICE_NAME=history_s1/s2/...` 环境变量为每个容器指定独立 checkpoint。

### 5.9 CrescendoHeight 设置过低（已修复）

**问题**：初始设置 `CrescendoHeight = 55,114,467`（Spork 23 root），但 Spork 23-25 仍然包含会导致 SDK panic 的老 Cadence 类型。S5 在 65M 高度经历三层 fallback（SDK → panic recovery → raw gRPC），每批次 9-11 分钟。

**修复**：提升到 `CrescendoHeight = 88,226,267`（Spork 26 root），确保所有 pre-Cadence 1.0 的块都走 raw gRPC。S5 速度从 9-11 min → 2m22s/batch。

### 5.10 单个 TX Result 请求（已优化）

**问题**：`fetchResultsAllRaw` 为每个交易单独发一个 `GetTransactionResultRaw` RPC。对于有 30+ 交易的块，50 workers × 30 goroutines = 1500 并发 gRPC 请求，超过 HTTP/2 stream limit，大量请求被序列化。

**修复**：实现批量 raw gRPC 方法 `GetTransactionResultsByBlockIDRaw`，一次 RPC 获取所有结果。速度提升：
- S5: 9-11 min → 2m22s/batch (~4.5x)
- S6: 4.5-5 min → 2m5s/batch (~2.3x)
- S2: 6-8 min → 3m15s/batch (~2x)

### 5.11 Candidate Spork 未覆盖（待修复）

**问题**：代码只包含 Mainnet 1-28 的 root heights，未包含 Candidate 7-9。S1 的可索引范围少了 4,132,133 → 7,601,062 约 347 万块。

**状态**：待添加 Candidate 7-9 到 `mainnetSporkRootHeights` 和节点列表。

---

## 六、当前运行状态

### 容器配置

```
GCP VM: flowscan-history (us-central1-a, e2-standard-16, 16 vCPU / 64GB)
Cloud SQL: flowscan-db (PostgreSQL 16, 34.69.114.28)
Image: us-central1-docker.pkg.dev/flow-octopus/flowscan/backend:latest

通用参数:
  RAW_ONLY=true                    # 只跑 ingester，禁用所有 worker
  ENABLE_FORWARD_INGESTER=false    # 禁用正向 ingester
  ENABLE_HISTORY_INGESTER=true     # 启用历史 ingester
  SKIP_MIGRATION=true              # 跳过 schema migration
  HISTORY_WORKER_COUNT=50          # 50 个并发 worker
  FLOW_RPC_RPS=-1                  # 禁用全局限速
  FLOW_RPC_RPS_PER_NODE=2000       # 每节点 2000 RPS 上限
```

| 容器 | Spork 范围 | 高度范围 | Batch Size | Access Nodes |
|------|-----------|---------|------------|--------------|
| S1 | 1-4 | 7,601,063 → 12,020,337 | 500 | mainnet1-4 |
| S2 | 5-9 | 12,020,337 → 15,791,891 | 500 | mainnet5-9 |
| S3 | 10-15 | 15,791,891 → 23,830,813 | 500 | mainnet10-15 |
| S4 | 16-21 | 23,830,813 → 47,169,687 | 200 | mainnet16-21 |
| S5 | 22-23 | 47,169,687 → 65,264,619 | 200 | mainnet22-23 |
| S6 | 24 | 65,264,619 → 85,981,135 | 500 | mainnet24 |

### 当前进度（2026-02-18 09:20 UTC）

| 容器 | Checkpoint | 目标 | 剩余块数 | 已完成 % | 实测速度 |
|------|-----------|------|---------|---------|---------|
| S1 | 12,000,337 | 7,601,063 | 4,399,274 | 0.4% | ⚠️ 卡住（mainnet4 DNS 不稳） |
| S2 | 15,456,391 | 12,020,337 | 3,436,054 | 8.9% | ~500 blocks/min |
| S3 | 23,683,813 | 15,791,891 | 7,891,922 | 1.8% | ~200 blocks/min |
| S4 | 46,874,887 | 23,830,813 | 23,044,074 | 1.3% | ~100 blocks/min |
| S5 | 64,966,629 | 47,169,687 | 17,796,942 | 1.6% | ~200 blocks/min |
| S6 | 85,482,635 | 65,264,619 | 20,218,016 | 2.4% | ~400 blocks/min |

### 按当前速度预估完成时间

| 容器 | 剩余块数 | 速度 (blocks/min) | 预计耗时 |
|------|---------|-------------------|---------|
| S1 | 4.4M | ~50 (乐观) | **~60 天** |
| S2 | 3.4M | ~500 | **~4.7 天** |
| S3 | 7.9M | ~200 | **~27 天** |
| S4 | 23.0M | ~100 | **~160 天** ⚠️ |
| S5 | 17.8M | ~200 | **~62 天** |
| S6 | 20.2M | ~400 | **~35 天** |

**S4（Spork 16-21）是最大瓶颈**，预计需要 5 个月以上。主要原因是 Spork 21 节点极慢。

---

## 七、可能的优化方向

### 7.1 拆分 S4 的 Spork 范围（推荐，立即可做）

S4 目前覆盖 Spork 16-21（23,830,813 → 47,169,687）。但各 Spork 速度差异极大：
- Spork 16-20：节点响应正常，预计每块 1-3s
- **Spork 21**：节点响应极慢（单次 RPC 可达 57s），只有 ~220 万块 (44,950,207 → 47,169,687) 却占大部分时间

建议拆分：
- S4a: Spork 16-20（23,830,813 → 44,950,207）— 会快很多
- S4b: Spork 21（44,950,207 → 47,169,687）— 慢但只有 220 万块，耐心等

### 7.2 添加 Candidate 7-9 支持（容易，立即可做）

在代码中添加 Candidate Spork 的 root heights 和节点地址，让 S1 能索引 4,132,133 → 7,601,062（约 347 万块）。这些节点实测响应很快（~200ms）。

### 7.3 联系 Flow 团队

- 询问是否有 **Archive Node** 能覆盖所有历史 Spork（现有 archive node 只覆盖当前 spork）
- 询问 Candidate 4-6 节点是否能升级到支持标准 Access API
- 询问是否有更快的 Spork 21/23 节点、Mirror、或批量数据导出
- 询问是否能获得 Spork 21/23 节点的 IP 白名单优先级

### 7.4 使用第三方数据源

如 QuickNode、Alchemy 或 Bitquery 等第三方 Flow 数据提供商，可能有预索引的历史数据可以批量导入，跳过最慢的 Spork 节点。

### 7.5 自建 Flow Access Node

- 运行自己的 Access Node 可以避免公共节点的性能限制
- 需要大量磁盘（数 TB）和初始同步时间
- 需要为每个旧 Spork 单独运行节点（可能不现实）

---

## 八、技术架构图

```
                 ┌──────────────────────────────────────────────┐
                 │          Flow Spork Access Nodes              │
                 │                                              │
                 │  candidate7-9    ──► 4.1M ~ 7.6M (快)       │
                 │  mainnet1-4      ──► 7.6M ~ 12.0M           │
                 │  mainnet5-9      ──► 12.0M ~ 15.8M          │
                 │  mainnet10-15    ──► 15.8M ~ 23.8M          │
                 │  mainnet16-20    ──► 23.8M ~ 44.9M          │
                 │  mainnet21       ──► 44.9M ~ 47.2M (极慢!)  │
                 │  mainnet22-23    ──► 47.2M ~ 65.3M (慢)     │
                 │  mainnet24       ──► 65.3M ~ 86.0M          │
                 │  mainnet25-28    ──► 86.0M ~ 139M+          │
                 └────────────┬─────────────────────────────────┘
                              │ gRPC (200ms ~ 60s per call)
                 ┌────────────▼─────────────────────────────────┐
                 │    GCP VM: flowscan-history                   │
                 │    e2-standard-16 (us-central1-a)             │
                 │                                              │
                 │  ┌──────┐ ┌──────┐ ┌──────┐                 │
                 │  │  S1  │ │  S2  │ │  S3  │  x 50 workers  │
                 │  │sp1-4 │ │sp5-9 │ │sp10-15│  each          │
                 │  └──────┘ └──────┘ └──────┘                 │
                 │  ┌──────┐ ┌──────┐ ┌──────┐                 │
                 │  │  S4  │ │  S5  │ │  S6  │                 │
                 │  │sp16-21│ │sp22-23│ │sp24 │                 │
                 │  └──────┘ └──────┘ └──────┘                 │
                 └────────────┬─────────────────────────────────┘
                              │ PostgreSQL (pgx, batch insert)
                 ┌────────────▼─────────────────────────────────┐
                 │    Cloud SQL: flowscan-db                     │
                 │    PostgreSQL 16 (us-central1-c)              │
                 │    34.69.114.28                               │
                 └──────────────────────────────────────────────┘
```

---

## 九、监控

- **监控脚本**：`/tmp/flowscan-monitor.sh`
- **日志**：`/tmp/flowscan-monitor.log`
- **频率**：每 10 分钟检查一次
- **自动操作**：
  - 自动清理死 worker lease（attempt >= 21）
  - 自动重启崩溃的容器
  - 记录 checkpoint 进度、batch 时间、错误计数
