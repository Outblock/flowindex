# Analytics Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full analytics metric board page at `/analytics` with KPI cards and time-series charts covering network activity, gas/fees, error rates, token transfers, EVM adoption, and staking.

**Architecture:** Frontend-first approach. The existing `/status/stat` endpoint already returns all `daily_stats` data (tx_count, evm_tx_count, total_gas_used, active_accounts, new_contracts). We add 2 new backend endpoints for analytics-specific aggregations (transfer volumes, error rates), then build the frontend page using existing Recharts + Shadcn/UI patterns.

**Tech Stack:** Go (backend API), React 19, TanStack Router (file-based routing), Recharts, TailwindCSS, Shadcn/UI

---

### Task 1: Add new backend repository methods for analytics

**Files:**
- Create: `backend/internal/repository/analytics.go`

**Step 1: Create analytics repository file**

```go
package repository

import (
	"context"
	"time"
)

type AnalyticsDailyRow struct {
	Date           string  `json:"date"`
	TxCount        int64   `json:"tx_count"`
	EVMTxCount     int64   `json:"evm_tx_count"`
	CadenceTxCount int64   `json:"cadence_tx_count"`
	TotalGasUsed   int64   `json:"total_gas_used"`
	ActiveAccounts int64   `json:"active_accounts"`
	NewContracts   int     `json:"new_contracts"`
	FailedTxCount  int64   `json:"failed_tx_count"`
	ErrorRate      float64 `json:"error_rate"`
	AvgGasPerTx    float64 `json:"avg_gas_per_tx"`
}

// GetAnalyticsDailyStats returns enriched daily stats with error rates and computed fields.
// It joins daily_stats with tx_metrics aggregates.
func (r *Repository) GetAnalyticsDailyStats(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH ds AS (
			SELECT date, tx_count, COALESCE(evm_tx_count, 0) AS evm_tx_count,
				COALESCE(total_gas_used, 0) AS total_gas_used,
				active_accounts, new_contracts
			FROM app.daily_stats
			WHERE date >= $1::date AND date <= $2::date
			ORDER BY date ASC
		),
		errors AS (
			SELECT date_trunc('day', l.timestamp)::date AS date,
				COUNT(*) FILTER (WHERE m.execution_status != 0) AS failed_count
			FROM app.tx_metrics m
			JOIN raw.tx_lookup l ON l.id = m.transaction_id AND l.block_height = m.block_height
			WHERE l.timestamp >= $1::timestamptz AND l.timestamp < ($2::date + interval '1 day')
			GROUP BY 1
		)
		SELECT ds.date::text, ds.tx_count, ds.evm_tx_count,
			(ds.tx_count - ds.evm_tx_count) AS cadence_tx_count,
			ds.total_gas_used, ds.active_accounts, ds.new_contracts,
			COALESCE(e.failed_count, 0) AS failed_tx_count,
			CASE WHEN ds.tx_count > 0
				THEN ROUND((COALESCE(e.failed_count, 0)::numeric / ds.tx_count * 100), 2)
				ELSE 0 END AS error_rate,
			CASE WHEN ds.tx_count > 0
				THEN ROUND((ds.total_gas_used::numeric / ds.tx_count), 2)
				ELSE 0 END AS avg_gas_per_tx
		FROM ds
		LEFT JOIN errors e ON e.date = ds.date
		ORDER BY ds.date ASC`

	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AnalyticsDailyRow
	for rows.Next() {
		var row AnalyticsDailyRow
		if err := rows.Scan(
			&row.Date, &row.TxCount, &row.EVMTxCount, &row.CadenceTxCount,
			&row.TotalGasUsed, &row.ActiveAccounts, &row.NewContracts,
			&row.FailedTxCount, &row.ErrorRate, &row.AvgGasPerTx,
		); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

type TransferDailyRow struct {
	Date          string `json:"date"`
	FTTransfers   int64  `json:"ft_transfers"`
	NFTTransfers  int64  `json:"nft_transfers"`
}

// GetTransferDailyStats returns daily FT and NFT transfer counts.
func (r *Repository) GetTransferDailyStats(ctx context.Context, from, to time.Time) ([]TransferDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		),
		ft AS (
			SELECT date_trunc('day', timestamp)::date AS date, COUNT(*) AS cnt
			FROM app.ft_transfers
			WHERE timestamp >= $1::timestamptz AND timestamp < ($2::date + interval '1 day')
			GROUP BY 1
		),
		nft AS (
			SELECT date_trunc('day', timestamp)::date AS date, COUNT(*) AS cnt
			FROM app.nft_transfers
			WHERE timestamp >= $1::timestamptz AND timestamp < ($2::date + interval '1 day')
			GROUP BY 1
		)
		SELECT d.date::text, COALESCE(f.cnt, 0), COALESCE(n.cnt, 0)
		FROM dates d
		LEFT JOIN ft f ON f.date = d.date
		LEFT JOIN nft n ON n.date = d.date
		ORDER BY d.date ASC`

	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []TransferDailyRow
	for rows.Next() {
		var row TransferDailyRow
		if err := rows.Scan(&row.Date, &row.FTTransfers, &row.NFTTransfers); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
```

**Step 2: Verify backend compiles**

Run: `cd backend && go build ./...`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add backend/internal/repository/analytics.go
git commit -m "feat(analytics): add repository methods for analytics daily stats and transfer volumes"
```

---

### Task 2: Add backend API endpoints for analytics

**Files:**
- Create: `backend/internal/api/v1_handlers_analytics.go`
- Modify: `backend/internal/api/routes_registration.go`

**Step 1: Create analytics handler file**

```go
package api

import (
	"net/http"
	"time"
)

func (s *Server) handleAnalyticsDaily(w http.ResponseWriter, r *http.Request) {
	from, to := parseAnalyticsDateRange(r)
	stats, err := s.repo.GetAnalyticsDailyStats(r.Context(), from, to)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, stats, map[string]interface{}{"count": len(stats)}, nil)
}

func (s *Server) handleAnalyticsTransfersDaily(w http.ResponseWriter, r *http.Request) {
	from, to := parseAnalyticsDateRange(r)
	stats, err := s.repo.GetTransferDailyStats(r.Context(), from, to)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, stats, map[string]interface{}{"count": len(stats)}, nil)
}

// parseAnalyticsDateRange extracts ?from=YYYY-MM-DD&to=YYYY-MM-DD, defaulting to last 90 days.
func parseAnalyticsDateRange(r *http.Request) (time.Time, time.Time) {
	now := time.Now().UTC()
	to := now
	from := now.AddDate(0, 0, -90)

	if v := r.URL.Query().Get("from"); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			from = t
		}
	}
	if v := r.URL.Query().Get("to"); v != "" {
		if t, err := time.Parse("2006-01-02", v); err == nil {
			to = t
		}
	}
	return from, to
}
```

**Step 2: Register routes in routes_registration.go**

Add to `registerStatusRoutes` function, after the existing status routes:

```go
// Analytics endpoints
r.HandleFunc("/analytics/daily", s.handleAnalyticsDaily).Methods("GET", "OPTIONS")
r.HandleFunc("/analytics/transfers/daily", s.handleAnalyticsTransfersDaily).Methods("GET", "OPTIONS")
```

**Step 3: Verify backend compiles**

Run: `cd backend && go build ./...`
Expected: SUCCESS

**Step 4: Commit**

```bash
git add backend/internal/api/v1_handlers_analytics.go backend/internal/api/routes_registration.go
git commit -m "feat(analytics): add /analytics/daily and /analytics/transfers/daily API endpoints"
```

---

### Task 3: Add "Analytics" entry to Sidebar

**Files:**
- Modify: `frontend/app/components/Sidebar.tsx`

**Step 1: Add BarChart3 icon import and nav item**

In the icon imports (line 3), add `BarChart3`:
```typescript
import { Home, Box, ArrowRightLeft, Users, FileText, Layers, ChevronLeft, ChevronRight, Sun, Moon, Coins, Image, Clock, Menu, X, BarChart3 } from 'lucide-react';
```

In the navItems array (after the Home entry at line 21), add:
```typescript
{ label: 'Analytics', path: '/analytics', icon: BarChart3 },
```

**Step 2: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20` (may show route error until route file exists - that's OK)

**Step 3: Commit**

```bash
git add frontend/app/components/Sidebar.tsx
git commit -m "feat(analytics): add Analytics entry to sidebar navigation"
```

---

### Task 4: Create analytics API helper in frontend

**Files:**
- Modify: `frontend/app/api/heyapi.ts`

**Step 1: Add fetchAnalyticsDaily and fetchAnalyticsTransfersDaily functions**

Append to the end of `frontend/app/api/heyapi.ts`:

```typescript
/** Fetch analytics daily stats (enriched with error rates, EVM split) */
export async function fetchAnalyticsDaily(from?: string, to?: string): Promise<any[]> {
  await ensureHeyApiConfigured();
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${_baseURL}/analytics/daily${qs}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data ?? [];
}

/** Fetch daily FT/NFT transfer counts */
export async function fetchAnalyticsTransfersDaily(from?: string, to?: string): Promise<any[]> {
  await ensureHeyApiConfigured();
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${_baseURL}/analytics/transfers/daily${qs}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data ?? [];
}
```

**Step 2: Commit**

```bash
git add frontend/app/api/heyapi.ts
git commit -m "feat(analytics): add frontend API helpers for analytics endpoints"
```

---

### Task 5: Create the Analytics page with KPI cards and charts

**Files:**
- Create: `frontend/app/routes/analytics.tsx`

**Step 1: Create the analytics route page**

This is the main page file. It contains:
- 6 KPI summary cards at the top
- Time range selector (7D / 30D / 90D / All)
- 6 chart sections in a 2-column grid
- Uses Recharts AreaChart, BarChart patterns from DailyStatsChart.tsx

The page fetches data from:
- `/analytics/daily` (main daily stats with error rates)
- `/analytics/transfers/daily` (FT/NFT transfer counts)
- `/status/price` + `/status/price/history` (FLOW price)
- `/staking/epoch/stats` (epoch/staking data)
- `/status/count` (totals)

Create file `frontend/app/routes/analytics.tsx` with:
- `createFileRoute('/analytics')` export
- State: `rangeDays` (7/30/90/9999), loading states for each data source
- 5 parallel useEffect fetches on mount (all data, max range)
- Computed `visibleData` sliced from full dataset based on rangeDays
- KPI cards row: Total Txs, Active Accounts (24h), Gas Burned (24h), Error Rate (24h), FLOW Price, Contracts Deployed
- Each KPI card shows value + delta badge vs previous day (green up / red down)
- Chart sections: Network Activity, Gas & Fees, Tx Health, Token Economy, EVM Adoption, Staking
- Each chart is a Recharts AreaChart or BarChart inside a card matching existing DailyStatsChart styling
- Nothing Phone aesthetic: monochrome, geometric, `#00ef8b` accent, uppercase tracking-widest headers

Key chart specifications:
1. **Network Activity - Tx Count**: Stacked area (Cadence green, EVM blue) with `cadence_tx_count` + `evm_tx_count`
2. **Network Activity - Active Accounts**: Area chart of `active_accounts`
3. **Gas & Fees - Gas Burned**: Area chart of `total_gas_used`
4. **Gas & Fees - Avg Gas/Tx**: Area chart of `avg_gas_per_tx`
5. **Tx Health - Error Rate**: Area chart of `error_rate` (%)
6. **Tx Health - Failed Txs**: Bar chart of `failed_tx_count`
7. **Token Economy - FT Transfers**: Area chart of `ft_transfers`
8. **Token Economy - NFT Transfers**: Area chart of `nft_transfers`
9. **Token Economy - FLOW Price**: Line chart from price history
10. **EVM Adoption - EVM vs Cadence**: Stacked area (same data as #1, different framing)
11. **Staking - Total Staked**: Line chart from epoch_stats
12. **Staking - Rewards/Epoch**: Bar chart from epoch_stats
13. **Staking - Node Count**: Line chart from epoch_stats

**Step 2: Regenerate TanStack Router route tree**

Run: `cd frontend && npx tsr generate`
Expected: `routeTree.gen.ts` updated with `/analytics` route

**Step 3: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: SUCCESS (or only pre-existing warnings)

**Step 4: Commit**

```bash
git add frontend/app/routes/analytics.tsx frontend/app/routeTree.gen.ts
git commit -m "feat(analytics): create full analytics dashboard page with KPI cards and charts"
```

---

### Task 6: Visual verification and polish

**Step 1: Start frontend dev server and verify the page renders**

Run: `cd frontend && npm run dev`
Navigate to `http://localhost:5173/analytics`

**Step 2: Verify sidebar link works and highlights correctly**

**Step 3: Check responsive layout (mobile drawer includes Analytics)**

**Step 4: Commit any polish fixes**

```bash
git add -A
git commit -m "fix(analytics): polish layout and responsive styling"
```
