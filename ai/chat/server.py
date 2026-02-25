#!/usr/bin/env python3
"""
Flow EVM Blockscout Text-to-SQL service using Vanna v2.

Provides:
- Web UI at http://localhost:8084
- Agent-based SQL generation with Anthropic Claude
- PostgreSQL query execution via IAP tunnel or direct connection
- REST API for Bot/Agent integration
"""

import os
import re
import sys
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
import psycopg
import uvicorn
from psycopg.rows import dict_row
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from vanna import Agent
from vanna.core.registry import ToolRegistry
from vanna.core.user import UserResolver, User, RequestContext
from vanna.tools import RunSqlTool, VisualizeDataTool
from vanna.tools.agent_memory import (
    SaveQuestionToolArgsTool,
    SearchSavedCorrectToolUsesTool,
    SaveTextMemoryTool,
)
from vanna.servers.fastapi import VannaFastAPIServer
from vanna.integrations.anthropic import AnthropicLlmService
from vanna.integrations.local.agent_memory import DemoAgentMemory
from vanna.capabilities.sql_runner import SqlRunner, RunSqlToolArgs
from vanna.core.tool import ToolContext

import config
from db import validate_sql, run_query
from train import build_system_prompt


# ---------------------------------------------------------------------------
# Query history store (in-memory, persists for server lifetime)
# ---------------------------------------------------------------------------
class QueryHistory:
    def __init__(self, max_items: int = 200):
        self.items: list[dict] = []
        self.max_items = max_items

    def add(self, question: str, sql: str, result_preview: Optional[dict], error: Optional[str] = None):
        item = {
            "id": str(uuid.uuid4())[:8],
            "question": question,
            "sql": sql,
            "row_count": result_preview.get("row_count", 0) if result_preview else 0,
            "error": error,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        self.items.insert(0, item)
        if len(self.items) > self.max_items:
            self.items = self.items[: self.max_items]
        return item

    def list(self, limit: int = 50, offset: int = 0):
        return self.items[offset : offset + limit]

    def get(self, item_id: str):
        for item in self.items:
            if item["id"] == item_id:
                return item
        return None


history = QueryHistory()


# ---------------------------------------------------------------------------
# PostgreSQL SqlRunner (for Vanna agent)
# ---------------------------------------------------------------------------
class PostgresRunner(SqlRunner):
    """Execute SQL against Blockscout PostgreSQL."""

    def __init__(self, conninfo: str, timeout_s: int = 30, max_rows: int = 500):
        self.conninfo = conninfo
        self.timeout_s = timeout_s
        self.max_rows = max_rows

    async def run_sql(self, args: RunSqlToolArgs, context: ToolContext) -> pd.DataFrame:
        with psycopg.connect(self.conninfo, autocommit=True, row_factory=dict_row) as conn:
            conn.execute(f"SET statement_timeout = '{self.timeout_s}s'")
            cur = conn.execute(args.sql)
            rows = cur.fetchmany(self.max_rows)

            if not rows:
                return pd.DataFrame()

            # Convert bytea to hex strings for display
            clean_rows = []
            for row in rows:
                clean = {}
                for k, v in row.items():
                    if isinstance(v, (bytes, bytearray, memoryview)):
                        clean[k] = "0x" + bytes(v).hex()
                    else:
                        clean[k] = v
                clean_rows.append(clean)

            return pd.DataFrame(clean_rows)


# ---------------------------------------------------------------------------
# Simple user resolver (no auth required for internal tool)
# ---------------------------------------------------------------------------
class InternalUserResolver(UserResolver):
    async def resolve_user(self, request_context: RequestContext) -> User:
        email = request_context.get_cookie("vanna_email") or "internal@flow.com"
        return User(id=email, email=email, group_memberships=["admin"])


# ---------------------------------------------------------------------------
# Pydantic models for REST API
# ---------------------------------------------------------------------------
class AskRequest(BaseModel):
    question: str = Field(..., description="Natural language question")
    execute: bool = Field(True, description="Whether to execute the generated SQL")

class AskResponse(BaseModel):
    question: str
    sql: str
    columns: list[str] = []
    rows: list[dict] = []
    row_count: int = 0
    error: Optional[str] = None
    duration_ms: int = 0

class RunSqlRequest(BaseModel):
    sql: str = Field(..., description="SQL query to execute (SELECT only)")

class RunSqlResponse(BaseModel):
    sql: str
    columns: list[str] = []
    rows: list[dict] = []
    row_count: int = 0
    error: Optional[str] = None
    duration_ms: int = 0

class GenerateSqlRequest(BaseModel):
    question: str = Field(..., description="Natural language question")

class GenerateSqlResponse(BaseModel):
    question: str
    sql: str
    duration_ms: int = 0

class HistoryItem(BaseModel):
    id: str
    question: str
    sql: str
    row_count: int
    error: Optional[str]
    timestamp: str


# ---------------------------------------------------------------------------
# Build and run
# ---------------------------------------------------------------------------
def main():
    # LLM
    llm = AnthropicLlmService(
        model=config.LLM_MODEL,
        api_key=config.ANTHROPIC_API_KEY,
    )

    # Database (Vanna agent uses Flowindex DB by default)
    db_tool = RunSqlTool(
        sql_runner=PostgresRunner(
            conninfo=config.FLOWINDEX_DATABASE_URL,
            timeout_s=config.QUERY_TIMEOUT_S,
            max_rows=config.MAX_RESULT_ROWS,
        )
    )

    # Agent memory (in-memory, stores learned Q→SQL pairs at runtime)
    agent_memory = DemoAgentMemory(max_items=2000)

    # Tool registry
    tools = ToolRegistry()
    tools.register_local_tool(db_tool, access_groups=["admin", "user"])
    tools.register_local_tool(VisualizeDataTool(), access_groups=["admin", "user"])
    tools.register_local_tool(SaveQuestionToolArgsTool(), access_groups=["admin"])
    tools.register_local_tool(SearchSavedCorrectToolUsesTool(), access_groups=["admin", "user"])
    tools.register_local_tool(SaveTextMemoryTool(), access_groups=["admin", "user"])

    # Build system prompt with DDL + docs + examples
    sys_prompt = build_system_prompt()

    # Agent
    from vanna.core.system_prompt.base import SystemPromptBuilder

    class FlowEVMPromptBuilder(SystemPromptBuilder):
        async def build_system_prompt(self, user, tools) -> str:
            return sys_prompt

    agent = Agent(
        llm_service=llm,
        tool_registry=tools,
        user_resolver=InternalUserResolver(),
        agent_memory=agent_memory,
        system_prompt_builder=FlowEVMPromptBuilder(),
    )

    # Create Vanna server and get the FastAPI app
    vanna_server = VannaFastAPIServer(agent)
    app = vanna_server.create_app()

    # -----------------------------------------------------------------
    # Custom REST API endpoints (v1 — for Bot/Agent integration)
    # -----------------------------------------------------------------

    @app.post("/api/v1/ask", response_model=AskResponse, tags=["REST API"])
    async def api_ask(req: AskRequest):
        """
        Natural language → SQL → execute → results (one-shot).
        This is the main endpoint for Bot/Agent integration.
        """
        t0 = time.monotonic()

        # Use Vanna agent via chat_poll-like flow to generate SQL
        # For simplicity, we use direct LLM call with the system prompt
        from anthropic import Anthropic
        client = Anthropic(api_key=config.ANTHROPIC_API_KEY)

        msg = client.messages.create(
            model=config.LLM_MODEL,
            max_tokens=2048,
            system=sys_prompt + "\n\nIMPORTANT: Return ONLY the SQL query, no explanation. Do not wrap in markdown code blocks.",
            messages=[{"role": "user", "content": req.question}],
        )
        sql = msg.content[0].text.strip()
        # Strip markdown code fences if present
        if sql.startswith("```"):
            sql = "\n".join(sql.split("\n")[1:])
        if sql.endswith("```"):
            sql = "\n".join(sql.split("\n")[:-1])
        sql = sql.strip()

        result = None
        error = None

        if req.execute:
            try:
                result = run_query(sql, config.QUERY_TIMEOUT_S, config.MAX_RESULT_ROWS)
            except Exception as e:
                error = str(e)

        duration_ms = int((time.monotonic() - t0) * 1000)
        history.add(req.question, sql, result, error)

        return AskResponse(
            question=req.question,
            sql=sql,
            columns=result["columns"] if result else [],
            rows=result["rows"] if result else [],
            row_count=result["row_count"] if result else 0,
            error=error,
            duration_ms=duration_ms,
        )

    @app.post("/api/v1/generate_sql", response_model=GenerateSqlResponse, tags=["REST API"])
    async def api_generate_sql(req: GenerateSqlRequest):
        """Generate SQL from a natural language question (no execution)."""
        t0 = time.monotonic()

        from anthropic import Anthropic
        client = Anthropic(api_key=config.ANTHROPIC_API_KEY)

        msg = client.messages.create(
            model=config.LLM_MODEL,
            max_tokens=2048,
            system=sys_prompt + "\n\nIMPORTANT: Return ONLY the SQL query, no explanation. Do not wrap in markdown code blocks.",
            messages=[{"role": "user", "content": req.question}],
        )
        sql = msg.content[0].text.strip()
        if sql.startswith("```"):
            sql = "\n".join(sql.split("\n")[1:])
        if sql.endswith("```"):
            sql = "\n".join(sql.split("\n")[:-1])
        sql = sql.strip()

        duration_ms = int((time.monotonic() - t0) * 1000)
        return GenerateSqlResponse(question=req.question, sql=sql, duration_ms=duration_ms)

    @app.post("/api/v1/run_sql", response_model=RunSqlResponse, tags=["REST API"])
    async def api_run_sql(req: RunSqlRequest):
        """Execute a SQL query directly (SELECT only)."""
        t0 = time.monotonic()
        try:
            result = run_query(req.sql, config.QUERY_TIMEOUT_S, config.MAX_RESULT_ROWS)
            duration_ms = int((time.monotonic() - t0) * 1000)
            return RunSqlResponse(
                sql=req.sql,
                columns=result["columns"],
                rows=result["rows"],
                row_count=result["row_count"],
                duration_ms=duration_ms,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            duration_ms = int((time.monotonic() - t0) * 1000)
            return RunSqlResponse(sql=req.sql, error=str(e), duration_ms=duration_ms)

    @app.get("/api/v1/history", response_model=list[HistoryItem], tags=["REST API"])
    async def api_history(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)):
        """List recent query history."""
        return history.list(limit, offset)

    @app.get("/api/v1/history/{item_id}", response_model=HistoryItem, tags=["REST API"])
    async def api_history_item(item_id: str):
        """Get a specific history item."""
        item = history.get(item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Not found")
        return item

    @app.delete("/api/v1/history", tags=["REST API"])
    async def api_clear_history():
        """Clear all query history."""
        history.items.clear()
        return {"status": "cleared"}

    # -----------------------------------------------------------------
    # Run server
    # -----------------------------------------------------------------
    print(f"Starting Vanna v2 server on http://0.0.0.0:{config.PORT}")
    print(f"  Web UI:    http://localhost:{config.PORT}")
    print(f"  API docs:  http://localhost:{config.PORT}/docs")
    print(f"  REST API:  http://localhost:{config.PORT}/api/v1/ask")
    print(f"  History:   http://localhost:{config.PORT}/api/v1/history")

    uvicorn.run(app, host=config.HOST, port=config.PORT)


if __name__ == "__main__":
    main()
