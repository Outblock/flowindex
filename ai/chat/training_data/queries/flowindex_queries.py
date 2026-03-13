"""
Training query pairs for the FlowIndex database.
Each entry is (question, sql).
"""

TRAINING_PAIRS = [
    (
        "Show me the latest 10 native Flow transactions",
        """
        SELECT '0x' || encode(id, 'hex') AS tx_id,
               block_height,
               transaction_index,
               status,
               gas_used,
               timestamp
        FROM raw.transactions
        ORDER BY block_height DESC, transaction_index DESC
        LIMIT 10
        """,
    ),
    (
        "最新的 10 笔 Flow 原生交易",
        """
        SELECT '0x' || encode(id, 'hex') AS tx_id,
               block_height,
               transaction_index,
               status,
               gas_used,
               timestamp
        FROM raw.transactions
        ORDER BY block_height DESC, transaction_index DESC
        LIMIT 10
        """,
    ),
    (
        "Look up a transaction by id",
        """
        SELECT '0x' || encode(t.id, 'hex') AS tx_id,
               l.block_height,
               t.transaction_index,
               t.status,
               t.error_message,
               t.gas_limit,
               t.gas_used,
               t.timestamp
        FROM raw.tx_lookup l
        JOIN raw.transactions t
          ON t.block_height = l.block_height
         AND t.id = l.id
        WHERE l.id = decode('cc686a52f6a6232d7dff0bf337e63dc3b672d512c225bda2044db0c515dd3c2f', 'hex')
        LIMIT 1
        """,
    ),
    (
        "Show the latest 20 FT transfers",
        """
        SELECT '0x' || encode(transaction_id, 'hex') AS tx_id,
               '0x' || encode(from_address, 'hex') AS from_address,
               '0x' || encode(to_address, 'hex') AS to_address,
               amount,
               contract_name,
               timestamp
        FROM app.ft_transfers
        ORDER BY block_height DESC, event_index DESC
        LIMIT 20
        """,
    ),
    (
        "过去 30 天每天的交易数和活跃账户数",
        """
        SELECT date,
               tx_count,
               active_accounts
        FROM app.daily_stats
        WHERE date >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY date
        """,
    ),
    (
        "Latest FLOW market price",
        """
        SELECT asset,
               currency,
               price,
               price_change_24h,
               market_cap,
               as_of
        FROM app.market_prices
        WHERE asset = 'FLOW'
          AND currency = 'USD'
        ORDER BY as_of DESC
        LIMIT 1
        """,
    ),
]
