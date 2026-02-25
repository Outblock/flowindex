#!/usr/bin/env python3
"""
Build the system prompt from DDL, docs, and example queries.
This replaces the Vanna training step — all context is fed directly to the LLM.

Usage:
    python train.py              # Print the built prompt (for inspection)
    python train.py --stats      # Print token estimate
"""

import argparse
from pathlib import Path


def load_ddl() -> str:
    """Load all DDL files."""
    ddl_dir = Path(__file__).parent / "training_data" / "ddl"
    parts = []
    for f in sorted(ddl_dir.glob("*.sql")):
        parts.append(f.read_text())
    return "\n\n".join(parts)


def load_docs() -> str:
    """Load all documentation."""
    docs_dir = Path(__file__).parent / "training_data" / "docs"
    parts = []
    for f in sorted(docs_dir.glob("*.md")):
        parts.append(f.read_text())
    return "\n\n".join(parts)


def load_examples() -> str:
    """Load example query pairs as formatted text."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent / "training_data" / "queries"))
    from flow_evm_queries import TRAINING_PAIRS

    lines = []
    for i, (question, sql) in enumerate(TRAINING_PAIRS, 1):
        lines.append(f"Example {i}:")
        lines.append(f"  Q: {question}")
        lines.append(f"  SQL: {sql.strip()}")
        lines.append("")
    return "\n".join(lines)


def build_system_prompt() -> str:
    """Build the full system prompt with DDL, docs, and examples."""
    ddl = load_ddl()
    docs = load_docs()
    examples = load_examples()

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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()

    prompt = build_system_prompt()

    if args.stats:
        # Rough token estimate: ~4 chars per token
        est_tokens = len(prompt) // 4
        print(f"System prompt length: {len(prompt):,} chars (~{est_tokens:,} tokens)")
        print(f"DDL: {len(load_ddl()):,} chars")
        print(f"Docs: {len(load_docs()):,} chars")
        print(f"Examples: {len(load_examples()):,} chars")
    else:
        print(prompt)


if __name__ == "__main__":
    main()
