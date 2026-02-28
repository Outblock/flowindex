# Balance Tab Redesign — Multi-Token + CSV Export + Staking Awareness

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the account Balance tab to support multi-token balance history, CSV export (daily snapshots + transfer detail), and staking-aware FLOW balance display.

**Architecture:** Frontend-heavy rewrite of `AccountBalanceTab.tsx`. No backend changes needed — existing APIs already support per-token balance history (`/balance/history?token=X`) and FT holdings. Staking data is fetched on-chain via Cadence and already available in the parent page component. CSV export is client-side.

**Tech Stack:** React, Recharts (AreaChart + sparklines), @tanstack/react-router, Cadence on-chain queries, existing REST APIs.

---

## Context: Key Existing APIs

- `GET /flow/v1/account/{address}/balance/history?token=A.xxx.FlowToken&days=30` → `{ data: [{date, balance}], _meta: {current_balance} }`
- `GET /flow/v1/account/{address}/ft/holding` → `{ data: [{address, token, balance, percentage}] }` (DB holdings)
- `GET /flow/v1/account/{address}/ft/transfer?limit=50&offset=0` → `{ data: [{tx_id, token, from, to, amount, timestamp}], _meta: {has_more} }`
- `GET /flow/v1/ft?limit=100` → FT metadata (name, symbol, logo, is_verified)
- On-chain: `cadenceService.getToken(address)` → real-time FT vault balances
- On-chain: `cadenceService.getStakingInfo(address)` → staking node/delegator info (already fetched in parent `$address.tsx` line 193)

## Context: Key Files

- **Current balance tab:** `frontend/app/components/account/AccountBalanceTab.tsx` (194 lines) — single FLOW chart
- **Tokens tab (pattern reference):** `frontend/app/components/account/AccountTokensTab.tsx` — shows how to fetch on-chain tokens + backend metadata
- **Parent page:** `frontend/app/routes/accounts/$address.tsx` — tab routing, already fetches staking data at line 191-203
- **API client:** `frontend/app/api.ts` — `resolveApiBaseUrl()` for fetch calls
- **Generated SDK:** `frontend/app/api/gen/find/sdk.gen.ts` — `getFlowV1AccountByAddressFtHolding()`
- **GlassCard component:** `frontend/app/components/ui/GlassCard.tsx`

---

### Task 1: Pass staking + token data to Balance tab

**Files:**
- Modify: `frontend/app/routes/accounts/$address.tsx:569`

**Step 1: Update the Balance tab rendering to pass staking and on-chain token data**

Currently line 569:
```tsx
{activeTab === 'balance' && <AccountBalanceTab address={normalizedAddress} />}
```

Change to:
```tsx
{activeTab === 'balance' && <AccountBalanceTab address={normalizedAddress} staking={onChainData?.staking} tokens={onChainData?.tokens} />}
```

Note: `onChainData` already contains `.staking` (fetched at line 193) and we need to also pass `.tokens` which is available from the `getToken` call at line 192 (`tokenRes`). Check that `onChainData` stores the token result — if not, add it.

Look at line 191-203 to see how `onChainData` is assembled. The `tokenRes` is fetched but we need to confirm the tokens array is stored. Currently `onChainData` has shape `{ balance, storage, staking, coaAddress }` (line 173). Add `tokens` to it.

**Step 2: Verify the build compiles**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep -i "AccountBalance\|address.tsx" | head -10`
Expected: No new errors from our changes (pre-existing errors in other files are OK)

**Step 3: Commit**

```
git add frontend/app/routes/accounts/\$address.tsx
git commit -m "feat(balance): pass staking and token data to AccountBalanceTab"
```

---

### Task 2: Rewrite AccountBalanceTab with token selector and staking cards

**Files:**
- Rewrite: `frontend/app/components/account/AccountBalanceTab.tsx`

This is the major rewrite. The new component structure:

```
AccountBalanceTab
├── Props: { address, staking?, tokens? }
├── State: selectedToken, days, balanceHistory[], ftHoldings[], ftMeta[]
├── Effects: fetch balance history when token/days change, fetch holdings list
│
├── Staking Summary Cards (FLOW only)
│   └── Vault | Staked | Rewards | Total
├── Token Selector + Time Range + Export Button
├── Main Area Chart (same style as current)
├── All Token Overview List
│   └── Per token: logo, name, balance, period change, sparkline
```

**Step 1: Create the new component**

Replace the entire `AccountBalanceTab.tsx` with the new implementation. Key sections:

**a) Updated Props and imports:**
```tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { resolveApiBaseUrl } from '../../api';
import { normalizeAddress, getTokenLogoURL } from './accountUtils';
import { GlassCard } from '../ui/GlassCard';
import { TrendingUp, TrendingDown, Minus, Download, ChevronDown, Coins, Landmark } from 'lucide-react';
import { getFlowV1Ft } from '../../api/gen/find';
import type { StakingInfo, FTVaultInfo } from '../../../cadence/cadence.gen';

interface Props {
    address: string;
    staking?: StakingInfo;
    tokens?: FTVaultInfo[];
}
```

**b) Token list assembly:** Merge on-chain `tokens` prop (real balances) with backend FT metadata (logos, symbols). Build a list of `{ identifier, name, symbol, logo, balance }` sorted by balance desc. Default selected token = `A.1654653399040a61.FlowToken`.

**c) Staking summary cards (only when selected token is FlowToken):**
```tsx
// Extract from staking prop
const nodeInfos = staking?.nodeInfos || [];
const delegatorInfos = staking?.delegatorInfos || [];
const totalStaked = [...nodeInfos, ...delegatorInfos].reduce((s, i) => s + Number(i.tokensStaked || 0), 0);
const totalRewards = [...nodeInfos, ...delegatorInfos].reduce((s, i) => s + Number(i.tokensRewarded || 0), 0);
const totalUnstaking = [...nodeInfos, ...delegatorInfos].reduce((s, i) => s + Number(i.tokensUnstaking || 0), 0);
const totalCommitted = [...nodeInfos, ...delegatorInfos].reduce((s, i) => s + Number(i.tokensCommitted || 0), 0);
```

Display 4 cards: Vault Balance | Staked | Rewards + Unstaking | Total FLOW

**d) Token selector:** A `<select>` or custom dropdown listing all tokens from the assembled list. On change, fetch balance history for that token.

**e) Balance history fetch:** Same pattern as current, but use the selected token's identifier in the API URL: `/flow/v1/account/{address}/balance/history?token=${selectedToken}&days=${days}`

**f) Main area chart:** Same Recharts AreaChart as current (keep exact same styling).

**g) All Token Overview list:** Below the chart, show a table/list of all held tokens with:
- Logo + Name + Symbol
- Current balance
- Period change (requires fetching each token's history — use a lightweight approach: fetch 2-point history for each, or just show current balance without change for MVP)

For sparklines, use a tiny `<LineChart>` from Recharts (48x24px, no axes/grid, just the line). Fetch 14-day history for each token in the list. To avoid hammering the API, fetch them lazily or in batch.

**Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "AccountBalance" | head -10`

**Step 3: Commit**

```
git add frontend/app/components/account/AccountBalanceTab.tsx
git commit -m "feat(balance): rewrite with multi-token selector, staking cards, token overview list"
```

---

### Task 3: CSV Export — Daily Balance Snapshots

**Files:**
- Modify: `frontend/app/components/account/AccountBalanceTab.tsx` (add export functions)

**Step 1: Add CSV export utility function**

```tsx
function downloadCsv(filename: string, headers: string[], rows: string[][]) {
    const csv = [
        headers.join(','),
        ...rows.map(r => r.map(cell => {
            const s = String(cell);
            return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
```

**Step 2: Add "Export Daily Balances" button**

When clicked, exports the current `balanceHistory` data:
```tsx
const exportDailyBalances = () => {
    const tokenLabel = selectedTokenMeta?.symbol || 'TOKEN';
    downloadCsv(
        `${address}-${tokenLabel}-daily-balances.csv`,
        ['date', 'token', 'balance'],
        data.map(p => [p.date, tokenLabel, p.balance.toString()])
    );
};
```

Place the button next to the time range selector in the chart header.

**Step 3: Commit**

```
git add frontend/app/components/account/AccountBalanceTab.tsx
git commit -m "feat(balance): add CSV export for daily balance snapshots"
```

---

### Task 4: CSV Export — Transfer Detail

**Files:**
- Modify: `frontend/app/components/account/AccountBalanceTab.tsx`

**Step 1: Add transfer fetch + export function**

```tsx
const exportTransfers = async () => {
    setExporting(true);
    try {
        const baseUrl = await resolveApiBaseUrl();
        const allTransfers: any[] = [];
        let offset = 0;
        const limit = 200;
        let hasMore = true;

        while (hasMore) {
            const res = await fetch(
                `${baseUrl}/flow/v1/account/${address}/ft/transfer?limit=${limit}&offset=${offset}`
            );
            const json = await res.json();
            const items = json.data || [];
            allTransfers.push(...items);
            hasMore = json._meta?.has_more && items.length === limit;
            offset += limit;
            if (offset > 10000) break; // safety limit
        }

        const tokenLabel = selectedTokenMeta?.symbol || 'ALL';
        downloadCsv(
            `${address}-${tokenLabel}-transfers.csv`,
            ['date', 'tx_id', 'token', 'from', 'to', 'amount'],
            allTransfers.map(t => [
                t.timestamp || t.block_time || '',
                t.transaction_id || t.tx_id || '',
                t.contract_name || t.token || '',
                t.from_address || '',
                t.to_address || '',
                t.amount || '0',
            ])
        );
    } catch (err) {
        console.error('Export failed', err);
    } finally {
        setExporting(false);
    }
};
```

**Step 2: Add export dropdown UI**

A small dropdown button with two options:
- "Daily Balances" → calls `exportDailyBalances()`
- "Transfer History" → calls `exportTransfers()`

Show a loading spinner on the button while `exporting` is true.

```tsx
const [exportOpen, setExportOpen] = useState(false);
const [exporting, setExporting] = useState(false);

// In the chart header, next to time range buttons:
<div className="relative">
    <button onClick={() => setExportOpen(!exportOpen)} className="...">
        <Download size={12} />
        <span>Export</span>
        <ChevronDown size={10} />
    </button>
    {exportOpen && (
        <div className="absolute right-0 top-full mt-1 ...">
            <button onClick={() => { exportDailyBalances(); setExportOpen(false); }}>
                Daily Balances
            </button>
            <button onClick={() => { exportTransfers(); setExportOpen(false); }}>
                Transfer History {exporting && <Loader2 className="animate-spin" />}
            </button>
        </div>
    )}
</div>
```

**Step 3: Commit**

```
git add frontend/app/components/account/AccountBalanceTab.tsx
git commit -m "feat(balance): add CSV export for transfer history"
```

---

### Task 5: Polish and visual QA

**Files:**
- Modify: `frontend/app/components/account/AccountBalanceTab.tsx`

**Step 1: Visual checks**

- Verify dark mode styling on all new elements
- Verify mobile responsiveness (stacking of cards, token selector)
- Check sparkline rendering for tokens with no history (show flat line or dash)
- Test empty states: account with 0 tokens, account with only FLOW
- Test with the specific account from the issue: `0x84221fe0294044d7`

**Step 2: Edge cases**

- Token with no balance history data → show "No history" in chart area
- Very large token list → cap the overview list at ~20 tokens, add "show more"
- Export with 0 data points → disable export button
- Close export dropdown on outside click

**Step 3: Final commit**

```
git add frontend/app/components/account/AccountBalanceTab.tsx
git commit -m "fix(balance): polish multi-token balance tab UI and edge cases"
```

---

## Summary

| Task | Description | Estimated Complexity |
|------|-------------|---------------------|
| 1 | Pass staking/token data to Balance tab | Small (5 lines) |
| 2 | Rewrite AccountBalanceTab (token selector, staking cards, overview list) | Large (main work) |
| 3 | CSV export: daily balances | Small (utility + button) |
| 4 | CSV export: transfer detail with pagination | Medium (async fetch loop) |
| 5 | Polish and edge cases | Medium (visual QA) |

**No backend changes required.** All existing APIs support the needed functionality.
