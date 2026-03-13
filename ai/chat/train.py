#!/usr/bin/env python3
"""
Build dual Vanna prompts for FlowIndex and Flow EVM.

Usage:
    python train.py --target flowindex
    python train.py --target evm
    python train.py --target flowindex --stats
"""

import argparse
import importlib
import sys
from pathlib import Path

TRAINING_DIR = Path(__file__).parent / "training_data"


def load_text(relative_path: str) -> str:
    return (TRAINING_DIR / relative_path).read_text()


def load_examples(module_name: str) -> str:
    sys.path.insert(0, str(TRAINING_DIR / "queries"))
    module = importlib.import_module(module_name)
    lines: list[str] = []
    for i, (question, sql) in enumerate(module.TRAINING_PAIRS, 1):
        lines.append(f"Example {i}:")
        lines.append(f"  Q: {question}")
        lines.append(f"  SQL: {sql.strip()}")
        lines.append("")
    return "\n".join(lines)


def build_flowindex_system_prompt() -> str:
    ddl = load_text("ddl/flowindex_tables.sql")
    cadence_docs = load_text("docs/flow_cadence.md")
    examples = load_examples("flowindex_queries")

    return f"""You are a SQL expert for the FlowIndex PostgreSQL database.
Your job is to convert natural language questions about native Flow / Cadence indexed data into SQL queries.

RULES:
- Output ONLY the SQL query, no explanation, no markdown fences, no comments.
- Only generate SELECT or WITH...SELECT queries. Never INSERT/UPDATE/DELETE/DROP/ALTER.
- The main schemas are raw.* and app.*. Prefer schema-qualified table names when precision matters.
- Transaction ids, addresses, contract addresses, and many identifiers are stored as bytea.
- To display bytea ids or addresses: '0x' || encode(column, 'hex')
- To filter by id/address: decode('abcdef...', 'hex') without the 0x prefix
- For direct transaction lookup, prefer raw.tx_lookup joined with raw.transactions.
- For token and transfer analytics, prefer app.ft_transfers, app.nft_transfers, app.ft_holdings, app.nft_ownership, and related app.* tables.
- For market data and aggregates, prefer app.market_prices, app.daily_stats, app.tx_metrics, and app.status_snapshots.
- Use NOW() - INTERVAL for time filters.
- Always add a reasonable LIMIT clause unless the user explicitly asks for aggregates or a full time series.
- If the question is ambiguous, make the most useful reasonable assumption.

## DATABASE SCHEMA

{ddl}

## FLOW / CADENCE REFERENCE

{cadence_docs}

## EXAMPLE QUERIES

{examples}"""


def build_evm_system_prompt() -> str:
    ddl = load_text("ddl/core_tables.sql")
    docs = load_text("docs/flow_evm_blockscout.md")
    examples = load_examples("flow_evm_queries")

    return f"""You are a SQL expert for the Flow EVM Blockscout database (PostgreSQL).
Your job is to convert natural language questions into SQL queries.

RULES:
- Output ONLY the SQL query, no explanation, no markdown fences, no comments.
- Only generate SELECT or WITH...SELECT queries. Never INSERT/UPDATE/DELETE/DROP/ALTER.
- Use the exact table and column names from the schema below.
- Addresses are stored as bytea. To display them as hex: '0x' || encode(column, 'hex')
- To filter by address: decode('abcdef...', 'hex') (without 0x prefix)
- Token values are in wei (divide by 10^decimals or 1e18 for native FLOW).
- transactions.status: 1 = success, 0 = failure.
- Use NOW() - INTERVAL for time-based filters.
- Always add reasonable LIMIT clauses (default 20) unless the user specifies otherwise.
- If the question is ambiguous, make reasonable assumptions and pick the most useful query.

## DATABASE SCHEMA

{ddl}

## DOCUMENTATION

{docs}

## EXAMPLE QUERIES

{examples}"""


def build_system_prompt(target: str = "flowindex") -> str:
    if target == "evm":
        return build_evm_system_prompt()
    if target == "flowindex":
        return build_flowindex_system_prompt()
    raise ValueError(f"Unknown target: {target}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["flowindex", "evm"], default="flowindex")
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()

    prompt = build_system_prompt(args.target)

    if args.stats:
        est_tokens = len(prompt) // 4
        print(f"Target: {args.target}")
        print(f"System prompt length: {len(prompt):,} chars (~{est_tokens:,} tokens)")
    else:
        print(prompt)


if __name__ == "__main__":
    main()
