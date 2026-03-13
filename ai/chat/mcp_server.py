#!/usr/bin/env python3
"""
FlowIndex AI MCP Server.

Exposes:
- ask_flowindex_vanna tool: Natural language -> SQL -> execute via the Vanna server
- generate_flowindex_sql tool: Natural language -> SQL via the Vanna server
- ask_evm_vanna tool: Natural language -> SQL -> execute against the Flow EVM Vanna target
- generate_evm_sql tool: Natural language -> SQL against the Flow EVM Vanna target
- run_flowindex_sql tool: Execute read-only SQL against the Flowindex database
- run_evm_sql tool: Execute read-only SQL against the Blockscout (Flow EVM) database
- run_cadence tool: Execute read-only Cadence scripts on Flow mainnet

Run: python mcp_server.py
"""

import base64
import json

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
            f"{config.BACKEND_URL}/auth/verify-key",
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

    # Allow in-container direct calls (e.g. /api/chat -> http://localhost:8085/mcp)
    # without requiring an API key. External traffic proxied by nginx includes
    # X-Forwarded-For and will still go through normal auth checks.
    client_host = (request.client.host if request.client else "") or ""
    xff = request.headers.get("x-forwarded-for", "").strip()
    if not xff and client_host in ("127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "localhost"):
        return await call_next(request)

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

FLOW_ACCESS_API = config.__dict__.get(
    "FLOW_ACCESS_API", "https://rest-mainnet.onflow.org/v1"
)

mcp = FastMCP(
    name="flow-ai",
    instructions="Flow blockchain AI tools — SQL queries against Flowindex PostgreSQL "
    "(Cadence/native Flow data) and Blockscout PostgreSQL (EVM data), "
    "plus Vanna-powered text-to-SQL for both FlowIndex and Flow EVM, and "
    "Cadence script execution on Flow mainnet.",
)


# ---------------------------------------------------------------------------
# Vanna proxy helpers
# ---------------------------------------------------------------------------
def _vanna_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if config.VANNA_API_TOKEN:
        headers["Authorization"] = f"Bearer {config.VANNA_API_TOKEN}"
    return headers


def _vanna_post(path: str, body: dict) -> dict:
    url = f"{config.VANNA_BASE_URL}{path}"
    try:
        resp = httpx.post(url, json=body, headers=_vanna_headers(), timeout=90)
    except httpx.TimeoutException:
        return {"error": f"Vanna request timed out calling {path}"}
    except Exception as e:
        return {"error": f"Vanna request failed calling {path}: {e}"}

    try:
        data = resp.json()
    except Exception:
        data = {"raw": resp.text}

    if resp.status_code >= 400:
        detail = data.get("detail") if isinstance(data, dict) else None
        return {
            "error": detail or f"Vanna API error ({resp.status_code})",
            "status_code": resp.status_code,
            "body": data,
        }

    if isinstance(data, dict):
        return data

    return {"result": data}


# ---------------------------------------------------------------------------
# Vanna FlowIndex tools
# ---------------------------------------------------------------------------
@mcp.tool()
def ask_flowindex_vanna(question: str) -> dict:
    """Use the FlowIndex Vanna service to answer a natural-language question.

    Vanna maintains the FlowIndex schema and examples internally. Prefer this
    over writing SQL from scratch when the request is about native Flow /
    Cadence indexed data. Returns generated SQL plus query results when
    execution succeeds.
    """
    return _vanna_post("/api/v1/flowindex/ask", {"question": question, "execute": True})


@mcp.tool()
def generate_flowindex_sql(question: str) -> dict:
    """Use the FlowIndex Vanna service to generate SQL from a natural-language question.

    Prefer this when you need SQL text for inspection or to refine a query
    before running it. Vanna maintains the FlowIndex schema internally, so you
    do not need to memorize table layouts in the chat prompt.
    """
    return _vanna_post("/api/v1/flowindex/generate_sql", {"question": question})


@mcp.tool()
def ask_evm_vanna(question: str) -> dict:
    """Use the Flow EVM Vanna target to answer a natural-language Blockscout question.

    Prefer this over writing Blockscout SQL from scratch when the request is
    about Flow EVM blocks, transactions, logs, tokens, smart contracts, or
    balances. Returns generated SQL plus query results when execution succeeds.
    """
    return _vanna_post("/api/v1/evm/ask", {"question": question, "execute": True})


@mcp.tool()
def generate_evm_sql(question: str) -> dict:
    """Use the Flow EVM Vanna target to generate SQL from a natural-language question.

    Prefer this when you want to inspect or refine Blockscout SQL before
    running it with `run_evm_sql`.
    """
    return _vanna_post("/api/v1/evm/generate_sql", {"question": question})


# ---------------------------------------------------------------------------
# Flowindex SQL tool
# ---------------------------------------------------------------------------
@mcp.tool()
def run_flowindex_sql(sql: str) -> dict:
    """Execute a read-only SELECT query against the Flowindex PostgreSQL database.

    This database contains indexed native Flow / Cadence blockchain data.
    Core relations live under the `raw.*` and `app.*` schemas.

    Important notes:
    - canonical transactions are typically in `raw.transactions`
    - raw events are typically in `raw.events`
    - many derived relations live in `app.*` (transfers, holdings, metrics, tags)
    - transaction ids and addresses are generally stored as BYTEA values

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
