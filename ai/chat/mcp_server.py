#!/usr/bin/env python3
"""
Flow AI MCP Server.

Exposes:
- run_flowindex_sql tool: Execute read-only SQL against the Flowindex database
- run_evm_sql tool: Execute read-only SQL against the Blockscout (Flow EVM) database
- run_cadence tool: Execute read-only Cadence scripts on Flow mainnet
- schema://flowindex-ddl resource: Flowindex database DDL
- schema://blockscout-ddl resource: Blockscout database DDL
- schema://docs resource: Flow EVM database documentation
- schema://cadence resource: Cadence script reference

Run: python mcp_server.py
"""

import base64
import json
from pathlib import Path

import httpx
from fastmcp import FastMCP

import config
from db import run_flowindex_query, run_blockscout_query

TRAINING_DATA = Path(__file__).parent / "training_data"

FLOW_ACCESS_API = config.__dict__.get(
    "FLOW_ACCESS_API", "https://rest-mainnet.onflow.org/v1"
)

mcp = FastMCP(
    name="flow-ai",
    instructions="Flow blockchain AI tools — SQL queries against Flowindex PostgreSQL "
    "(Cadence/native Flow data) and Blockscout PostgreSQL (EVM data), "
    "plus Cadence script execution on Flow mainnet.",
)


# ---------------------------------------------------------------------------
# Flowindex SQL tool
# ---------------------------------------------------------------------------
@mcp.tool()
def run_flowindex_sql(sql: str) -> dict:
    """Execute a read-only SELECT query against the Flowindex PostgreSQL database.

    This database contains native Flow/Cadence blockchain data:
    blocks, transactions, events, token transfers (FT/NFT), accounts,
    daily stats, staking/epoch data, and more.

    Returns {columns, rows, row_count} on success, or {error} on failure.
    Only SELECT queries are allowed.
    """
    try:
        return run_flowindex_query(sql, config.QUERY_TIMEOUT_S, config.MAX_RESULT_ROWS)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"Query failed: {e}"}


# ---------------------------------------------------------------------------
# Blockscout (EVM) SQL tool
# ---------------------------------------------------------------------------
@mcp.tool()
def run_evm_sql(sql: str) -> dict:
    """Execute a read-only SELECT query against the Flow EVM Blockscout PostgreSQL database.

    This database contains EVM-specific data: EVM blocks, transactions, tokens,
    smart contracts, logs, token transfers, etc.

    Returns {columns, rows, row_count} on success, or {error} on failure.
    Only SELECT queries are allowed.
    """
    try:
        return run_blockscout_query(sql, config.QUERY_TIMEOUT_S, config.MAX_RESULT_ROWS)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"Query failed: {e}"}


# ---------------------------------------------------------------------------
# Cadence tool
# ---------------------------------------------------------------------------
@mcp.tool()
def run_cadence(script: str, arguments: list[dict] | None = None) -> dict:
    """Execute a read-only Cadence script on Flow mainnet via the Access API.

    The script must contain an `access(all) fun main()` entry point.
    Arguments use JSON-Cadence format, e.g. [{"type":"Address","value":"0x1654653399040a61"}].
    Returns {result} on success or {error} on failure.
    """
    try:
        encoded_script = base64.b64encode(script.encode()).decode()
        encoded_args = [
            base64.b64encode(json.dumps(arg).encode()).decode()
            for arg in (arguments or [])
        ]

        resp = httpx.post(
            f"{FLOW_ACCESS_API}/scripts",
            json={"script": encoded_script, "arguments": encoded_args},
            timeout=30,
        )

        if resp.status_code != 200:
            return {"error": f"Flow Access API error ({resp.status_code}): {resp.text}"}

        # Response body is a base64-encoded JSON-Cadence value
        raw = resp.json()
        decoded = base64.b64decode(raw).decode()
        result = json.loads(decoded)
        return {"result": result}
    except httpx.TimeoutException:
        return {"error": "Script execution timed out (30s)"}
    except Exception as e:
        return {"error": f"Cadence execution failed: {e}"}


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------
@mcp.resource("schema://flowindex-ddl")
def get_flowindex_ddl() -> str:
    """Database DDL (CREATE TABLE statements) for the Flowindex database."""
    ddl_path = TRAINING_DATA / "ddl" / "flowindex_tables.sql"
    if ddl_path.exists():
        return ddl_path.read_text()
    return "-- Flowindex DDL not yet configured. Check training_data/ddl/flowindex_tables.sql"


@mcp.resource("schema://blockscout-ddl")
def get_blockscout_ddl() -> str:
    """Database DDL (CREATE TABLE statements) for the Flow EVM Blockscout database."""
    return (TRAINING_DATA / "ddl" / "core_tables.sql").read_text()


@mcp.resource("schema://docs")
def get_docs() -> str:
    """Flow EVM Blockscout database documentation."""
    return (TRAINING_DATA / "docs" / "flow_evm_blockscout.md").read_text()


@mcp.resource("schema://cadence")
def get_cadence_docs() -> str:
    """Cadence script reference — syntax, core contract addresses, common patterns."""
    return (TRAINING_DATA / "docs" / "flow_cadence.md").read_text()


if __name__ == "__main__":
    port = config.MCP_PORT
    print(f"Starting Flow AI MCP server on http://0.0.0.0:{port}/mcp")
    mcp.run(transport="streamable-http", host="0.0.0.0", port=port)
