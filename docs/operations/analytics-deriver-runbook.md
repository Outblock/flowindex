# Analytics Deriver Runbook

## 背景

Analytics 指标现在拆成两层：

- `app.daily_stats`：基础交易统计（tx_count / evm_tx_count / active_accounts / error_rate 等）
- `analytics.daily_metrics`：扩展 analytics 指标（new accounts / COA / EVM active / DeFi / epoch payout / bridge）

这样可以把 analytics 计算和 `raw`、`app` 主查询路径隔离，避免重查询拖慢页面。

## 数据表

### `analytics.daily_metrics`

按天聚合字段：

- `new_accounts`
- `coa_new_accounts`
- `evm_active_addresses`
- `defi_swap_count`
- `defi_unique_traders`
- `epoch_payout_total`
- `bridge_to_evm_txs`
- `updated_at`

## Worker

新增 `analytics_deriver_worker`：

- 名称：`analytics_deriver_worker`
- 处理模式：区块范围半开区间 `[fromHeight, toHeight)`
- 写入：
  - `app.daily_stats`（兼容现有核心图表）
  - `analytics.daily_metrics`（扩展模块指标）

## API 读取路径

- `/analytics/daily`：读取 `app.daily_stats`（快路径）
- `/analytics/daily/module/{module}`：读取 `analytics.daily_metrics`
  - `accounts`
  - `evm`
  - `defi`
  - `epoch`
  - `bridge`

## Admin Backfill

### 触发接口

`POST /admin/backfill-analytics`

Body:

```json
{
  "from_height": 134233971,
  "to_height": 143454064
}
```

说明：

- 必须满足 `to_height > from_height`
- 在后台 goroutine 执行
- 建议按区间分段执行（例如 30 天或 90 天窗口）

## Status 页面观测

`/status` 已包含：

- `worker_enabled.analytics_deriver_worker`
- `worker_config.analytics_deriver_worker`

你可以在 indexing status 页面直接看到它是否启用、range/concurrency 配置是否生效。

## 推荐上线参数

- `ENABLE_ANALYTICS_DERIVER_WORKER=true`
- `ANALYTICS_DERIVER_WORKER_RANGE=1000`（先保守）
- `ANALYTICS_DERIVER_WORKER_CONCURRENCY=1`（先单并发，避免写放大）

如果数据库压力可控，再逐步提高 range 或并发。

## 回填建议

1. 先回填最近 90 天，尽快恢复 dashboard 可用性。
2. 再分批向历史回填（按月或按季度）。
3. 每批完成后检查：
   - `/analytics/daily` 是否连续
   - `/analytics/daily/module/*` 是否返回非全 0
   - status 页面 worker 错误率和滞后高度

## 故障排查

### 症状：模块全 0

优先检查：

1. `analytics_deriver_worker` 是否启用
2. 是否已跑过对应高度范围 backfill
3. `analytics.daily_metrics` 对应日期是否有行

### 症状：请求超时

优先动作：

1. 缩小 backfill 区间
2. 降低 worker range/concurrency
3. 先保留核心图表（`/analytics/daily`），扩展模块按需显示

