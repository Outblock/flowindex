"""
Training query pairs for Flow EVM Blockscout.
Each entry is (question, sql).
"""

TRAINING_PAIRS = [
    # === Block queries ===
    (
        "What is the latest block number?",
        "SELECT max(number) AS latest_block FROM blocks",
    ),
    (
        "最新区块高度是多少？",
        "SELECT max(number) AS latest_block FROM blocks",
    ),
    (
        "How many blocks were produced in the last 24 hours?",
        "SELECT count(*) AS block_count FROM blocks WHERE timestamp > NOW() - INTERVAL '24 hours'",
    ),
    (
        "Show me the 10 most recent blocks with their gas usage",
        "SELECT number, gas_used, gas_limit, timestamp FROM blocks ORDER BY number DESC LIMIT 10",
    ),
    (
        "Average block time over the last 1000 blocks",
        """
        WITH recent AS (
            SELECT number, timestamp,
                   LAG(timestamp) OVER (ORDER BY number) AS prev_ts
            FROM blocks
            ORDER BY number DESC
            LIMIT 1000
        )
        SELECT AVG(EXTRACT(EPOCH FROM (timestamp - prev_ts))) AS avg_block_time_seconds
        FROM recent
        WHERE prev_ts IS NOT NULL
        """,
    ),
    (
        "过去一小时每个区块的平均 gas 使用率",
        """
        SELECT AVG(gas_used::numeric / NULLIF(gas_limit, 0)) AS avg_gas_utilization
        FROM blocks
        WHERE timestamp > NOW() - INTERVAL '1 hour'
        AND gas_limit > 0
        """,
    ),

    # === Transaction queries ===
    (
        "How many transactions in the last 24 hours?",
        "SELECT count(*) AS tx_count FROM transactions WHERE block_timestamp > NOW() - INTERVAL '24 hours'",
    ),
    (
        "过去24小时的交易数量",
        "SELECT count(*) AS tx_count FROM transactions WHERE block_timestamp > NOW() - INTERVAL '24 hours'",
    ),
    (
        "Show me the top 10 addresses by transaction count",
        """
        SELECT '0x' || encode(from_address_hash, 'hex') AS address,
               count(*) AS tx_count
        FROM transactions
        GROUP BY from_address_hash
        ORDER BY tx_count DESC
        LIMIT 10
        """,
    ),
    (
        "过去7天交易量最大的合约地址",
        """
        SELECT '0x' || encode(to_address_hash, 'hex') AS contract_address,
               count(*) AS tx_count
        FROM transactions
        WHERE block_timestamp > NOW() - INTERVAL '7 days'
          AND to_address_hash IS NOT NULL
        GROUP BY to_address_hash
        ORDER BY tx_count DESC
        LIMIT 20
        """,
    ),
    (
        "What is the total FLOW transferred in the last 24 hours?",
        """
        SELECT SUM(value) / 1e18 AS total_flow_transferred
        FROM transactions
        WHERE block_timestamp > NOW() - INTERVAL '24 hours'
          AND status = 1
        """,
    ),
    (
        "Transaction success rate over the last 24 hours",
        """
        SELECT
            count(*) AS total,
            count(*) FILTER (WHERE status = 1) AS success,
            count(*) FILTER (WHERE status = 0) AS failed,
            ROUND(100.0 * count(*) FILTER (WHERE status = 1) / NULLIF(count(*), 0), 2) AS success_rate_pct
        FROM transactions
        WHERE block_timestamp > NOW() - INTERVAL '24 hours'
        """,
    ),
    (
        "Show me the largest transactions by value in the last 7 days",
        """
        SELECT '0x' || encode(hash, 'hex') AS tx_hash,
               '0x' || encode(from_address_hash, 'hex') AS from_addr,
               '0x' || encode(to_address_hash, 'hex') AS to_addr,
               value / 1e18 AS flow_value,
               block_timestamp
        FROM transactions
        WHERE block_timestamp > NOW() - INTERVAL '7 days'
          AND status = 1
        ORDER BY value DESC
        LIMIT 20
        """,
    ),
    (
        "Daily transaction count for the past 30 days",
        """
        SELECT DATE(block_timestamp) AS day,
               count(*) AS tx_count
        FROM transactions
        WHERE block_timestamp > NOW() - INTERVAL '30 days'
        GROUP BY DATE(block_timestamp)
        ORDER BY day
        """,
    ),
    (
        "过去30天每天的交易数量趋势",
        """
        SELECT DATE(block_timestamp) AS day,
               count(*) AS tx_count
        FROM transactions
        WHERE block_timestamp > NOW() - INTERVAL '30 days'
        GROUP BY DATE(block_timestamp)
        ORDER BY day
        """,
    ),

    # === Token queries ===
    (
        "List all ERC-20 tokens ordered by holder count",
        """
        SELECT '0x' || encode(contract_address_hash, 'hex') AS token_address,
               name, symbol, holder_count, decimals
        FROM tokens
        WHERE type = 'ERC-20'
        ORDER BY holder_count DESC NULLS LAST
        LIMIT 50
        """,
    ),
    (
        "Show me top 10 WFLOW holders",
        """
        SELECT '0x' || encode(actb.address_hash, 'hex') AS holder_address,
               actb.value / POWER(10, COALESCE(t.decimals, 18)) AS balance,
               actb.block_number
        FROM address_current_token_balances actb
        JOIN tokens t ON t.contract_address_hash = actb.token_contract_address_hash
        WHERE t.symbol = 'WFLOW'
          AND actb.value > 0
        ORDER BY actb.value DESC
        LIMIT 10
        """,
    ),
    (
        "WFLOW 的 top 10 holders 是谁？",
        """
        SELECT '0x' || encode(actb.address_hash, 'hex') AS holder_address,
               actb.value / POWER(10, COALESCE(t.decimals, 18)) AS balance,
               actb.block_number
        FROM address_current_token_balances actb
        JOIN tokens t ON t.contract_address_hash = actb.token_contract_address_hash
        WHERE t.symbol = 'WFLOW'
          AND actb.value > 0
        ORDER BY actb.value DESC
        LIMIT 10
        """,
    ),
    (
        "How many unique holders does a specific token have?",
        """
        SELECT t.symbol, t.name,
               count(*) AS holder_count
        FROM address_current_token_balances actb
        JOIN tokens t ON t.contract_address_hash = actb.token_contract_address_hash
        WHERE t.symbol = 'WFLOW'
          AND actb.value > 0
        GROUP BY t.symbol, t.name
        """,
    ),
    (
        "Show me all ERC-721 (NFT) collections",
        """
        SELECT '0x' || encode(contract_address_hash, 'hex') AS token_address,
               name, symbol, holder_count, total_supply
        FROM tokens
        WHERE type = 'ERC-721'
        ORDER BY holder_count DESC NULLS LAST
        LIMIT 50
        """,
    ),
    (
        "Token transfer volume in the last 24 hours grouped by token",
        """
        SELECT t.symbol, t.name,
               count(*) AS transfer_count,
               count(DISTINCT tt.from_address_hash) AS unique_senders,
               count(DISTINCT tt.to_address_hash) AS unique_receivers
        FROM token_transfers tt
        JOIN tokens t ON t.contract_address_hash = tt.token_contract_address_hash
        JOIN blocks b ON b.number = tt.block_number
        WHERE b.timestamp > NOW() - INTERVAL '24 hours'
        GROUP BY t.symbol, t.name
        ORDER BY transfer_count DESC
        LIMIT 20
        """,
    ),
    (
        "过去24小时 token 转账次数最多的代币",
        """
        SELECT t.symbol, t.name,
               count(*) AS transfer_count
        FROM token_transfers tt
        JOIN tokens t ON t.contract_address_hash = tt.token_contract_address_hash
        JOIN blocks b ON b.number = tt.block_number
        WHERE b.timestamp > NOW() - INTERVAL '24 hours'
        GROUP BY t.symbol, t.name
        ORDER BY transfer_count DESC
        LIMIT 20
        """,
    ),

    # === Address queries ===
    (
        "Top 10 addresses by native FLOW balance",
        """
        SELECT '0x' || encode(hash, 'hex') AS address,
               fetched_coin_balance / 1e18 AS flow_balance,
               transactions_count
        FROM addresses
        WHERE fetched_coin_balance IS NOT NULL
        ORDER BY fetched_coin_balance DESC
        LIMIT 10
        """,
    ),
    (
        "FLOW 余额最多的前10个地址",
        """
        SELECT '0x' || encode(hash, 'hex') AS address,
               fetched_coin_balance / 1e18 AS flow_balance,
               transactions_count
        FROM addresses
        WHERE fetched_coin_balance IS NOT NULL
        ORDER BY fetched_coin_balance DESC
        LIMIT 10
        """,
    ),
    (
        "How many unique addresses have transacted on Flow EVM?",
        """
        SELECT count(DISTINCT from_address_hash) AS unique_senders,
               count(DISTINCT to_address_hash) AS unique_receivers
        FROM transactions
        """,
    ),
    (
        "New addresses created per day for the last 30 days",
        """
        SELECT DATE(inserted_at) AS day,
               count(*) AS new_addresses
        FROM addresses
        WHERE inserted_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(inserted_at)
        ORDER BY day
        """,
    ),

    # === Smart contract queries ===
    (
        "How many verified smart contracts are there?",
        "SELECT count(*) AS verified_contracts FROM smart_contracts",
    ),
    (
        "List the most recently verified contracts",
        """
        SELECT '0x' || encode(address_hash, 'hex') AS contract_address,
               name, compiler_version, optimization, inserted_at
        FROM smart_contracts
        ORDER BY inserted_at DESC
        LIMIT 20
        """,
    ),

    # === Indexer health / operational queries ===
    (
        "What is the current indexing status?",
        """
        SELECT 'latest_block' AS metric, max(number)::text AS value FROM blocks
        UNION ALL
        SELECT 'missing_ranges', count(*)::text FROM missing_block_ranges
        UNION ALL
        SELECT 'pending_block_ops', count(*)::text FROM pending_block_operations
        """,
    ),
    (
        "索引器状态如何？",
        """
        SELECT 'latest_block' AS metric, max(number)::text AS value FROM blocks
        UNION ALL
        SELECT 'missing_ranges', count(*)::text FROM missing_block_ranges
        UNION ALL
        SELECT 'pending_block_ops', count(*)::text FROM pending_block_operations
        """,
    ),
    (
        "Show database table sizes",
        """
        SELECT relname AS table_name,
               pg_size_pretty(pg_total_relation_size(relid)) AS total_size
        FROM pg_catalog.pg_statio_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 20
        """,
    ),
    (
        "How many unfetched token balances are pending?",
        """
        SELECT count(*) AS unfetched_balances
        FROM address_token_balances
        WHERE value_fetched_at IS NULL
        """,
    ),
    (
        "Token balance sync lag — tokens where current balances lag behind transfers",
        """
        WITH transfers AS (
            SELECT token_contract_address_hash, max(block_number) AS tmax
            FROM token_transfers
            GROUP BY token_contract_address_hash
        ),
        current_bal AS (
            SELECT token_contract_address_hash, max(block_number) AS cmax
            FROM address_current_token_balances
            GROUP BY token_contract_address_hash
        )
        SELECT '0x' || encode(tr.token_contract_address_hash, 'hex') AS token,
               t.symbol,
               tr.tmax AS transfers_max_block,
               COALESCE(cb.cmax, 0) AS balance_max_block,
               tr.tmax - COALESCE(cb.cmax, 0) AS lag_blocks
        FROM transfers tr
        LEFT JOIN current_bal cb USING (token_contract_address_hash)
        LEFT JOIN tokens t ON t.contract_address_hash = tr.token_contract_address_hash
        WHERE tr.tmax - COALESCE(cb.cmax, 0) > 0
        ORDER BY lag_blocks DESC
        LIMIT 20
        """,
    ),

    # === Rate limiting / API plan queries ===
    (
        "Show all API rate limit plans",
        """
        SELECT name, max_req_per_second
        FROM account_api_plans
        ORDER BY max_req_per_second
        """,
    ),
    (
        "How many users are on each API plan?",
        """
        SELECT COALESCE(p.name, 'No Plan') AS plan,
               COALESCE(p.max_req_per_second::text, 'N/A') AS limit_per_sec,
               count(i.id) AS user_count
        FROM account_identities i
        LEFT JOIN account_api_plans p ON i.plan_id = p.id
        GROUP BY p.name, p.max_req_per_second
        ORDER BY CASE WHEN p.max_req_per_second IS NULL THEN 0 ELSE p.max_req_per_second END
        """,
    ),

    # === Internal transactions ===
    (
        "Top 10 internal transaction value transfers in the last 24 hours",
        """
        SELECT '0x' || encode(transaction_hash, 'hex') AS tx_hash,
               '0x' || encode(from_address_hash, 'hex') AS from_addr,
               '0x' || encode(to_address_hash, 'hex') AS to_addr,
               value / 1e18 AS flow_value,
               type, call_type
        FROM internal_transactions
        WHERE block_number >= (SELECT max(number) - 28800 FROM blocks)
          AND value > 0
        ORDER BY value DESC
        LIMIT 10
        """,
    ),

    # === Logs ===
    (
        "How many log events in the last 24 hours?",
        """
        SELECT count(*) AS log_count
        FROM logs
        WHERE block_number >= (SELECT max(number) - 28800 FROM blocks)
        """,
    ),
]
