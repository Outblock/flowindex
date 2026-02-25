"""Shared database helpers for dual-DB SQL execution (Flowindex + Blockscout)."""

import re

import psycopg
import psycopg2
import psycopg2.extras
from psycopg.rows import dict_row

import config

DANGEROUS_SQL_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b",
    re.IGNORECASE,
)


def validate_sql(sql: str) -> None:
    """Raise if SQL contains non-SELECT statements."""
    if DANGEROUS_SQL_RE.search(sql):
        raise ValueError("Only SELECT queries are allowed")


def _run_query_psycopg3(db_url: str, sql: str, timeout_s: int, max_rows: int) -> dict:
    """Execute via psycopg3 (for Flowindex DB)."""
    validate_sql(sql)
    with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as conn:
        conn.execute(f"SET statement_timeout = '{timeout_s}s'")
        cur = conn.execute(sql)
        rows = cur.fetchmany(max_rows)
        if not rows:
            return {"columns": [], "rows": [], "row_count": 0}
        return _clean_rows(rows)


def _run_query_psycopg2(db_url: str, sql: str, timeout_s: int, max_rows: int) -> dict:
    """Execute via psycopg2 (for Blockscout DB — psycopg3 has SCRAM auth issues)."""
    validate_sql(sql)
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(f"SET statement_timeout = '{timeout_s}s'")
        cur.execute(sql)
        rows = cur.fetchmany(max_rows)
        if not rows:
            return {"columns": [], "rows": [], "row_count": 0}
        return _clean_rows([dict(r) for r in rows])
    finally:
        conn.close()


def _clean_rows(rows: list[dict]) -> dict:
    """Normalize rows: convert bytes to hex strings."""
    clean_rows = []
    for row in rows:
        clean = {}
        for k, v in row.items():
            if isinstance(v, (bytes, bytearray, memoryview)):
                clean[k] = "0x" + bytes(v).hex()
            else:
                clean[k] = v
        clean_rows.append(clean)
    columns = list(clean_rows[0].keys())
    return {"columns": columns, "rows": clean_rows, "row_count": len(clean_rows)}


def run_flowindex_query(sql: str, timeout_s: int = 30, max_rows: int = 500) -> dict:
    """Execute a read-only SQL query against the Flowindex database."""
    return _run_query_psycopg3(config.FLOWINDEX_DATABASE_URL, sql, timeout_s, max_rows)


def run_blockscout_query(sql: str, timeout_s: int = 30, max_rows: int = 500) -> dict:
    """Execute a read-only SQL query against the Blockscout (Flow EVM) database."""
    if not config.BLOCKSCOUT_DATABASE_URL:
        return {"error": "Blockscout database not configured"}
    return _run_query_psycopg2(config.BLOCKSCOUT_DATABASE_URL, sql, timeout_s, max_rows)


# Backwards-compatible alias
def run_query(sql: str, timeout_s: int = 30, max_rows: int = 500) -> dict:
    """Default: run against Flowindex DB."""
    return run_flowindex_query(sql, timeout_s, max_rows)
