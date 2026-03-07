#!/usr/bin/env python3
"""
FlowIndex AI MCP Server.

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

import time
import hashlib
from collections import defaultdict, deque

# ---------------------------------------------------------------------------
# In-memory sliding-window rate limiter (per API key)
# ---------------------------------------------------------------------------
class RateLimiter:
    """Sliding window rate limiter. Tracks timestamps per key."""

    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._windows: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        window = self._windows[key]
        cutoff = now - self.window_seconds
        while window and window[0] < cutoff:
            window.popleft()
        if len(window) >= self.max_requests:
            return False
        window.append(now)
        return True


_rate_limiter = RateLimiter(
    max_requests=config.MCP_RATE_LIMIT,
    window_seconds=60,
)

# Cache validated developer keys for 5 min to avoid hitting Go backend on every request.
_key_cache: dict[str, float] = {}  # {key_hash: expiry_timestamp}
_KEY_CACHE_TTL = 300  # seconds


async def _validate_developer_key(api_key: str) -> bool:
    """Validate a developer API key against the Go backend."""
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()

    cached_expiry = _key_cache.get(key_hash)
    if cached_expiry and time.time() < cached_expiry:
        return True

    try:
        resp = httpx.post(
            f"{config.BACKEND_URL}/flow/v1/auth/verify-key",
            headers={"X-API-Key": api_key},
            timeout=5,
        )
        if resp.status_code != 200:
            return False
        data = resp.json()
        if data.get("valid"):
            _key_cache[key_hash] = time.time() + _KEY_CACHE_TTL
            return True
        return False
    except Exception:
        return False


from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse


async def auth_middleware(request: Request, call_next):
    """ASGI middleware that checks API key auth before forwarding to FastMCP."""

    # Skip auth if disabled
    if not config.MCP_AUTH_ENABLED:
        return await call_next(request)

    # Extract key from Authorization header or x-api-key
    auth_header = request.headers.get("authorization", "")
    api_key = ""
    if auth_header.lower().startswith("bearer "):
        api_key = auth_header[7:].strip()
    if not api_key:
        api_key = request.headers.get("x-api-key", "").strip()

    if not api_key:
        return JSONResponse(
            {"error": "unauthorized", "message": "API key required. Pass via Authorization: Bearer <key> header."},
            status_code=401,
        )

    # Admin key — allow with no rate limit
    if config.MCP_ADMIN_KEY and api_key == config.MCP_ADMIN_KEY:
        return await call_next(request)

    # Developer key — validate against Go backend
    if not await _validate_developer_key(api_key):
        return JSONResponse(
            {"error": "unauthorized", "message": "Invalid or inactive API key."},
            status_code=401,
        )

    # Rate limit check
    if not _rate_limiter.allow(api_key):
        return JSONResponse(
            {"error": "rate_limited", "message": f"Rate limit exceeded ({config.MCP_RATE_LIMIT} req/min)."},
            status_code=429,
        )

    return await call_next(request)

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

    if config.MCP_AUTH_ENABLED:
        print(f"Starting FlowIndex AI MCP server on http://0.0.0.0:{port}/mcp (auth enabled)")
    else:
        print(f"Starting FlowIndex AI MCP server on http://0.0.0.0:{port}/mcp (auth DISABLED)")

    from starlette.middleware.base import BaseHTTPMiddleware

    mcp.run(
        transport="streamable-http",
        host="0.0.0.0",
        port=port,
        middleware=[Middleware(BaseHTTPMiddleware, dispatch=auth_middleware)],
    )
