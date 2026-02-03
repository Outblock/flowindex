# FlowScan Clone Development Plan

> Legacy plan (v1). For the current Schema V2 and scaling plan, see `schemav2.md`.

This plan outlines the architecture for a robust, restart-resilient Flow blockchain explorer, inspired by **Blockscout's** architecture but built natively for Flow using Go.

## 1. Architecture Overview

We will adopt a **3-tier architecture** similar to Blockscout:
1.  **Indexer (Backend Worker):** Continuously syncs with Flow Access Nodes via gRPC.
    -   *Distinct Feature:* Event-driven "Processor" pipeline (Raw Block -> Normalized Data).
2.  **Database (PostgreSQL):** The source of truth.
3.  **API/Frontend:** Read-only interface.

### 1.1 Tech Stack
-   **Backend:** Go (High throughput).
-   **DB:** PostgreSQL (Relational integrity).
-   **Frontend:** React + Vite (Fast UX).
-   **Infrastructure:** Docker + Docker Compose.
-   **Flow RPC:** `access-001.mainnet28.nodes.onflow.org:9000` (gRPC).

---

## 2. Database Design (Blockscout Enhanced)

We are expanding the schema to ~12 tables to support token tracking, NFT history, and fast account lookups, similar to Blockscout's `eth_bytecode_db` and `token_transfers`.

### Core Chain Tables
*The backbone of the chain.*

1.  **`blocks`**
    -   `height` (PK, BIGINT)
    -   `id` (Hash)
    -   `parent_id`
    -   `timestamp`
    -   `collection_count`
    -   `total_gas_used` (derived)
    -   `is_sealed` (Boolean) - *Wait for seal before indexing "final" state.*

2.  **`transactions`**
    -   `id` (PK, Hash)
    -   `block_height` (FK)
    -   `proposer_address`
    -   `payer_address`
    -   `authorizers` (Text[]) - *Flow multi-sig support.*
    -   `script` (Text - Cadence Code)
    -   `arguments` (JSONB) - *Decoded Cadence Params.*
    -   `status` (Sealed/Expired)
    -   `error_msg`
    -   `gas_limit`
    -   `gas_used`

3.  **`events`** (The "Logs")
    -   `id` (PK)
    -   `transaction_id` (FK)
    -   `type` (e.g., `A.0x1654653399040a61.FlowToken.TokensDeposited`)
    -   `event_index`
    -   `payload` (JSONB) - *Decoded Cadence Event fields.*

### Tokenization & Asset Tables (The "Blockscout" Layer)
*Flow uses events for transfers. We must normalize `FT.Deposit` and `NFT.Deposit` events into these tables.*

4.  **`tokens`** (Registry)
    -   `contract_address` (PK, e.g., `0x1654653399040a61`)
    -   `name` (e.g., "FlowToken")
    -   `symbol` (e.g., "FLOW")
    -   `decimals`
    -   `type` ('Fungible', 'NonFungible')

5.  **`token_transfers`** (Fungible History)
    -   `transaction_id` (FK)
    -   `block_height`
    -   `token_contract_address` (FK)
    -   `from_address` (Derived from Withdraw event or null for mint)
    -   `to_address` (Derived from Deposit event)
    -   `amount` (Numeric)
    *   *Index: (from_address, block_height), (to_address, block_height)* -> "Show me all USDC transfers"

6.  **`nft_transfers`** (NFT History)
    -   `transaction_id` (FK)
    -   `block_height`
    -   `token_contract_address` (FK)
    -   `nft_id` (BIGINT)
    -   `from_address`
    -   `to_address`

### Account & Identity Tables

7.  **`addresses`**
    -   `address` (PK)
    -   `balance_flow` (Updated periodically or via event hook)
    -   `is_contract` (Boolean)
    -   `name_tag` (e.g., "Binance Hot Wallet")

8.  **`smart_contracts`**
    -   `address` (FK)
    -   `name`
    -   `code` (Cadence Source)
    -   `abi` (JSON)
    -   `verification_status` ('Verified', 'Unverified')

9.  **`address_current_token_balances`**
    -   `address` (PK)
    -   `token_contract_address` (PK)
    -   `balance` (Numeric)
    -   `nft_count` (Int)

### Search & Indexing Optimization

10. **`address_transactions`** (The "Lookup Table")
    *   Maps ANY participation (Payer, Proposer, Token Receiver, Event Emitter) to a Tx.
    -   `address` (Indexed)
    -   `transaction_id`
    -   `block_height`
    -   `transaction_type` (General, Transfer, ContractDeploy)

11. **`indexing_checkpoints`**
    -   `service_name` ('block_ingester', 'token_processor')
    -   `last_height`

---

## 3. Backend Strategy: "The Pipeline"

To be as stable as Blockscout, we split the backend into **Micro-workers** (Goroutines or separate containers):

1.  **`Ingester`**:
    -   Fetches `Block` -> Writes to `blocks` & `transactions`.
    -   Fast, dumb, just data dump.
2.  **`Processor`** (Lagging 1 block behind):
    -   Reads `events`.
    -   **Parses** known events (`FlowToken.TokensDeposited` -> `token_transfers`).
    -   **Updates** `address_transactions` map.
    -   **Updates** `smart_contracts` if a `AccountCodeUpdated` event is found.
3.  **`VerifyWorker`**:
    -   Optional background job that checks contract bytecode against known sources.

### Resilience "The Blockscout Way"
-   **Idempotency:** Every database insert is `ON CONFLICT DO NOTHING` or `DO UPDATE`.
-   **Reorg Handling:** We track `parent_id`. If `fetched_block.parent_id != db.last_block.id`, we trigger a **Rollback** (delete last N blocks).

---

## 4. Environment Variables (Tuning)

```bash
# Core
DB_URL=postgres://user:pass@localhost:5432/flowscan
# Flow Network (gRPC)
FLOW_ACCESS_NODE=access-001.mainnet28.nodes.onflow.org:9000

# Tuning
INGESTER_BATCH_SIZE=50         # Blocks per RPC call
INGESTER_WORKERS=10            # Parallel block fetchers
PROCESSOR_ENABLED=true         # Turn off to run just as raw node
ENABLE_TOKEN_INDEXING=true     # Parse FT/NFT events? (CPU intensive)
RETENTION_DAYS=0               # 0 = Forever
```

---

## 5. Development Plan

### Phase 1: Core Ingestion (Days 1-2)
-   Implement `blocks`, `transactions`, `events` tables.
-   Build `FlowClient` with "Headless" mode (auto-sync tip).
-   Verify we can sync 10,000 blocks without crashing.

### Phase 2: Tokenization Layer (Days 3-4)
-   Implement `token_transfers` and `tokens`.
-   Write the `EventParser` engine to detect Standard Token events.
-   *Critical:* Map `TokensDeposited` + `TokensWithdrawn` to `from/to` transfers.

### Phase 3: API & Frontend (Days 5-6)
-   Endpoints:
    -   `GET /tx/{hash}` (Full details + Token Transfers)
    -   `GET /address/{addr}/tokens` (Holdings)
-   UI:
    -   "Latest Blocks" stream.
    -   "Account View" with Tabs: Transactions | Tokens | NFTs.

### Phase 4: Docker & Prod (Day 7)
-   `docker-compose` with:
    -   `db` (Postgres + Volumes)
    -   `backend` (The Indexer)
    -   `api` (The REST Server)
    -   `web` (Nginx + Static)

This structure provides the "Deep Data" (Token flows, Internal actions) that users expect from a Blockscout-level explorer, not just a surface-level block viewer.
