# API 字段审计总结 (Find API / OpenAPI v2)

本文是对线上 `https://flowscan.up.railway.app/api` 按 `openapi-v2.json` 做的字段级审计结论总结。完整逐字段结果见 `docs/status/api-field-audit.md` (生成文件) 与 `output/api-field-audit.json` (机器可读)。

## 审计范围与方法

- 依据：`openapi-v2.json` (OpenAPI 3.x) 的每个 `GET` endpoint 的 `200` 响应 schema。
- 实测：对每个 endpoint 发起一次请求 (limit/offset 尽量设为 1/0)，并用少量种子参数填充 path params。
- 结论类型：
  - `OK/MISSING/TYPE_MISMATCH/NULL/UNVERIFIED_EMPTY_ARRAY`
  - 另加少量语义 warning (比如 cadence type id / timestamp 格式)。

## 关键统计 (2026-02-07)

- 总 endpoints: 74
- 返回 `200`: 46
- 返回 `501` (Not Implemented): 26
- 无法构造有效样例参数而跳过: 2
  - `/flow/v1/evm/token/{address}` (EVM token list 为空，拿不到一个 token address)
  - `/flow/v1/nft/{nft_type}/item/{id}` (缺少 NFT item id 样本)

在 `HTTP 200` 的 46 个 endpoints 上：
- spec 期望字段(累计): 1115
- `OK`: 390
- `MISSING`: 522
- `UNVERIFIED_EMPTY_ARRAY`: 190 (样例数组为空，导致 item 字段无法验证)
- `EXTRA`(实现返回但 spec 没定义): 100
- `TYPE_MISMATCH`: 1

## 主要问题分类 (高优先级)

### 1) 响应 envelope/包装结构不一致

最常见的缺失字段是：
- `_links`、`_links.*`、`_meta.*`、`error`

这说明大量接口实现返回的 wrapper 与 spec 不一致 (实现往往只返回 `data` 或 `data + _meta`)。

建议：
- 如果我们把 spec 当作对外契约，就补齐统一 envelope：`{ _links, _meta, data, error }`。
- 如果我们认为当前实现更合理，则应同步修正 `openapi-v2.json`，否则所有 client 都会处于“猜字段”的状态。

### 2) 命名风格混用 (snake_case vs camelCase)

同一类资源在不同接口返回字段命名不一致，例如 account detail 返回 `flowBalance/flowStorage/storageUsed...` (camelCase)，而 list 返回 `flow_balance/flow_storage/...` (snake_case)。

建议：
- 选一个全局标准并改齐；对外 API 我建议统一 `snake_case` (更贴近当前 Find 生态与 spec)。

### 3) EVM 单笔交易接口与 spec 明显漂移

- `/flow/v1/evm/transaction/{hash}`：spec 期望返回 `flow.EvmTransactionOutput` (顶层平铺字段)，但实现返回 `{ data: [ ... ] }` wrapper。

建议：
- 对齐其中一个：要么实现改成“返回单对象”，要么 spec 改成 wrapper。
- 同时明确 `from/to` 是 EVM address (20 bytes) 不是 Flow address。

### 4) 交易 events / tags 结构漂移

spec 对 `flow.Event` 期望字段：`id/name/timestamp/block_height/event_index/fields`。

实现中 events 更像直接把 protobuf/cadence payload 丢出来 (出现 `payload.*` 这类字段)，导致：
- spec 字段缺失
- 返回 extra 字段很多

建议：
- 明确“raw event payload”是否应该出现在对外 API。通常 raw 应该进 `raw.*` 表和内部调试接口；对外接口返回 spec 结构，必要时再提供 `raw_payload` 可选字段。

### 5) FT/NFT token 标识符语义不一致 (cadence type id vs 合约地址)

例：`flow.FTHoldingOutput.token` spec 示例是 `A.<addr>.<Contract>.Vault`，但实现返回的是 `05b67ba314000b2d` 这种 16-hex 合约地址。

建议 (二选一)：
1. API/DB 以 cadence type id 作为主键 (Find 兼容性最好)；同时保留 `contract_address` 字段以便 join。
2. API/DB 以合约 address 作为主键；那就必须改 spec 并统一所有接口的 `token/nft_type/identifier` 字段含义。

目前表现属于“混合态”，会导致 client 无法可靠拼 URL 或 cross-link。

## “暂时拿不到/需要新 worker + table” 的点 (根据字段缺失与现有数据推断)

下面这些不是简单补字段就能解决，通常需要新的 derived worker 或新增表以保证未来 30-50TB 规模下的查询性能。

### A) EVM hash 映射 (Flow tx -> 多笔 EVM tx)

- Flow 一笔 cadence tx 里可能包含多笔 EVM tx (你给的 `A.e467b9dd11fa00df.EVM.TransactionExecuted` 事件就是关键)。
- 因此 `raw.tx_lookup.evm_hash` 这种 1:1 字段语义不成立，应该是 1:N。

建议表 (app schema)：
- `app.flow_evm_transactions`：
  - `flow_tx_id` (Flow tx hash)
  - `evm_tx_hash` (EVM tx hash)
  - `block_height`
  - `tx_index` / `event_index` (可选，用来稳定排序与排错)
  - 唯一约束 `(flow_tx_id, evm_tx_hash)`

worker：
- 解析 tx result events，仅抽取 `EVM.TransactionExecuted`，写入上述表。

### B) FT/NFT transfers / holdings / top accounts

当前 `ft/transfer`、`nft/transfer` 等 endpoint `data=[]`，属于“数据管道没跑出来”，不是 API handler 的问题。

建议：
- 以事件驱动的 worker，从链上 events 中提取 transfer/holding 变化，写入 `app.ft_transfers`、`app.nft_transfers`、`app.ft_holdings`、`app.nft_holdings`。
- 对 `top-account` 这类接口，务必预聚合或做可增量维护的表，否则在 TB 级数据上实时 group-by 会炸。

### C) block 级 metrics (total_gas_used / fees / surge_factor 等)

这些字段通常是“派生指标”：
- `total_gas_used` 如果要精确，一般来自 block 内交易的费用/执行信息聚合。
- 如果需要额外 RPC 或 parse 大量 events，会很重。

建议：
- 不要塞回 `raw.blocks`，而是做 `app.block_metrics` 或 `app.block_stats`。
- 不好算/暂时不算的字段先留空，但 API 要明确 `null`/`0` 的语义。

## Raw vs App 的建议落点

- `raw.*`：链上原始数据的可追溯存档 (block header、collection、transaction、必要的 events/tx results)，尽量按“可重放/可再派生”设计。
- `app.*`：面向查询与产品的派生/索引表 (balances/holdings/transfers/metrics/lookups)。
- `workers`：从 `raw -> app` 的增量流水线；对于需要复算的指标，优先设计成可重跑 (idempotent)。

我的建议是保持分层清晰：对外 API 大部分读 `app`，只有“debug/raw”类接口才读 `raw`。

## 下一步 (在开始修复前先对齐方向)

1. 确认：以 `openapi-v2.json` 作为对外契约，还是以现有返回为准去改 spec。
2. 优先修复最常用的页面/查询路径：
   - `/flow/v1/transaction`、`/flow/v1/transaction/{id}`
   - `/flow/v1/block`、`/flow/v1/block/{height}`
   - `/flow/v1/account`、`/flow/v1/account/{address}`
   - `/flow/v1/contract*`
   - `/flow/v1/evm/transaction*`
3. 再推进需要新 worker/table 的功能：FT/NFT transfers、EVM mapping、top accounts/collections 等。

