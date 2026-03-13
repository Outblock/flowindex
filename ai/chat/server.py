#!/usr/bin/env python3
"""
Dual-target Vanna REST service for FlowIndex and Flow EVM.

Provides:
- FlowIndex Vanna-compatible REST endpoints
- Flow EVM Vanna-compatible REST endpoints
- A default Vanna web UI rooted on the FlowIndex agent
"""

import time
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

import pandas as pd
import psycopg
import uvicorn
from fastapi import HTTPException, Query
from pydantic import BaseModel, Field
from psycopg.rows import dict_row

from vanna import Agent
from vanna.capabilities.sql_runner import RunSqlToolArgs, SqlRunner
from vanna.core.registry import ToolRegistry
from vanna.core.tool import ToolContext
from vanna.core.user import RequestContext, User, UserResolver
from vanna.integrations.anthropic import AnthropicLlmService
from vanna.integrations.local.agent_memory import DemoAgentMemory
from vanna.servers.fastapi import VannaFastAPIServer
from vanna.tools import RunSqlTool, VisualizeDataTool
from vanna.tools.agent_memory import (
    SaveQuestionToolArgsTool,
    SaveTextMemoryTool,
    SearchSavedCorrectToolUsesTool,
)

import config
from db import run_blockscout_query, run_flowindex_query
from train import build_evm_system_prompt, build_flowindex_system_prompt


class QueryHistory:
    def __init__(self, max_items: int = 200):
        self.items: list[dict] = []
        self.max_items = max_items

    def add(
        self,
        target: str,
        question: str,
        sql: str,
        result_preview: Optional[dict],
        error: Optional[str] = None,
    ):
        item = {
            "id": str(uuid.uuid4())[:8],
            "target": target,
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

    def list(self, limit: int = 50, offset: int = 0, target: str | None = None):
        items = self.items if not target else [item for item in self.items if item["target"] == target]
        return items[offset : offset + limit]

    def get(self, item_id: str):
        for item in self.items:
            if item["id"] == item_id:
                return item
        return None


history = QueryHistory()


class PostgresRunner(SqlRunner):
    """Execute SQL against a configured PostgreSQL connection."""

    def __init__(
        self,
        conninfo: str,
        timeout_s: int = 30,
        max_rows: int = 500,
        search_path: str | None = None,
    ):
        self.conninfo = conninfo
        self.timeout_s = timeout_s
        self.max_rows = max_rows
        self.search_path = search_path

    async def run_sql(self, args: RunSqlToolArgs, context: ToolContext) -> pd.DataFrame:
        with psycopg.connect(self.conninfo, autocommit=True, row_factory=dict_row) as conn:
            conn.execute(f"SET statement_timeout = '{self.timeout_s}s'")
            if self.search_path:
                conn.execute(f"SET search_path TO {self.search_path}")
            cur = conn.execute(args.sql)
            rows = cur.fetchmany(self.max_rows)

            if not rows:
                return pd.DataFrame()

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


class InternalUserResolver(UserResolver):
    async def resolve_user(self, request_context: RequestContext) -> User:
        email = request_context.get_cookie("vanna_email") or "internal@flow.com"
        return User(id=email, email=email, group_memberships=["admin"])


class AskRequest(BaseModel):
    question: str = Field(..., description="Natural language question")
    execute: bool = Field(True, description="Whether to execute the generated SQL")


class AskResponse(BaseModel):
    target: str
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
    target: str
    sql: str
    columns: list[str] = []
    rows: list[dict] = []
    row_count: int = 0
    error: Optional[str] = None
    duration_ms: int = 0


class GenerateSqlRequest(BaseModel):
    question: str = Field(..., description="Natural language question")


class GenerateSqlResponse(BaseModel):
    target: str
    question: str
    sql: str
    duration_ms: int = 0


class HistoryItem(BaseModel):
    id: str
    target: str
    question: str
    sql: str
    row_count: int
    error: Optional[str]
    timestamp: str


def create_agent(
    llm: AnthropicLlmService,
    system_prompt: str,
    conninfo: str,
    search_path: str | None = None,
) -> Agent:
    db_tool = RunSqlTool(
        sql_runner=PostgresRunner(
            conninfo=conninfo,
            timeout_s=config.QUERY_TIMEOUT_S,
            max_rows=config.MAX_RESULT_ROWS,
            search_path=search_path,
        )
    )

    tools = ToolRegistry()
    tools.register_local_tool(db_tool, access_groups=["admin", "user"])
    tools.register_local_tool(VisualizeDataTool(), access_groups=["admin", "user"])
    tools.register_local_tool(SaveQuestionToolArgsTool(), access_groups=["admin"])
    tools.register_local_tool(SearchSavedCorrectToolUsesTool(), access_groups=["admin", "user"])
    tools.register_local_tool(SaveTextMemoryTool(), access_groups=["admin", "user"])

    agent_memory = DemoAgentMemory(max_items=2000)

    from vanna.core.system_prompt.base import SystemPromptBuilder

    class StaticPromptBuilder(SystemPromptBuilder):
        async def build_system_prompt(self, user, tools) -> str:
            return system_prompt

    return Agent(
        llm_service=llm,
        tool_registry=tools,
        user_resolver=InternalUserResolver(),
        agent_memory=agent_memory,
        system_prompt_builder=StaticPromptBuilder(),
    )


def generate_sql_from_prompt(system_prompt: str, question: str) -> str:
    from anthropic import Anthropic

    client = Anthropic(api_key=config.ANTHROPIC_API_KEY)
    msg = client.messages.create(
        model=config.LLM_MODEL,
        max_tokens=2048,
        system=system_prompt
        + "\n\nIMPORTANT: Return ONLY the SQL query, no explanation. Do not wrap in markdown code blocks.",
        messages=[{"role": "user", "content": question}],
    )
    sql = msg.content[0].text.strip()
    if sql.startswith("```"):
        sql = "\n".join(sql.split("\n")[1:])
    if sql.endswith("```"):
        sql = "\n".join(sql.split("\n")[:-1])
    return sql.strip()


class SqlTarget:
    def __init__(
        self,
        key: str,
        label: str,
        system_prompt: str,
        run_query: Callable[[str, int, int], dict],
    ):
        self.key = key
        self.label = label
        self.system_prompt = system_prompt
        self.run_query = run_query


def build_targets() -> dict[str, SqlTarget]:
    return {
        "flowindex": SqlTarget(
            key="flowindex",
            label="FlowIndex",
            system_prompt=build_flowindex_system_prompt(),
            run_query=run_flowindex_query,
        ),
        "evm": SqlTarget(
            key="evm",
            label="Flow EVM",
            system_prompt=build_evm_system_prompt(),
            run_query=run_blockscout_query,
        ),
    }


def execute_sql(target: SqlTarget, sql: str) -> dict:
    return target.run_query(sql, config.QUERY_TIMEOUT_S, config.MAX_RESULT_ROWS)


def register_target_routes(app, prefix: str, target: SqlTarget) -> None:
    async def api_ask(req: AskRequest):
        t0 = time.monotonic()
        sql = generate_sql_from_prompt(target.system_prompt, req.question)
        result = None
        error = None

        if req.execute:
            try:
                result = execute_sql(target, sql)
                error = result.get("error")
            except Exception as e:
                error = str(e)

        duration_ms = int((time.monotonic() - t0) * 1000)
        history.add(target.key, req.question, sql, result, error)

        return AskResponse(
            target=target.key,
            question=req.question,
            sql=sql,
            columns=result["columns"] if result and "columns" in result else [],
            rows=result["rows"] if result and "rows" in result else [],
            row_count=result["row_count"] if result and "row_count" in result else 0,
            error=error,
            duration_ms=duration_ms,
        )

    async def api_generate_sql(req: GenerateSqlRequest):
        t0 = time.monotonic()
        sql = generate_sql_from_prompt(target.system_prompt, req.question)
        duration_ms = int((time.monotonic() - t0) * 1000)
        return GenerateSqlResponse(
            target=target.key,
            question=req.question,
            sql=sql,
            duration_ms=duration_ms,
        )

    async def api_run_sql(req: RunSqlRequest):
        t0 = time.monotonic()
        try:
            result = execute_sql(target, req.sql)
            if result.get("error"):
                return RunSqlResponse(
                    target=target.key,
                    sql=req.sql,
                    error=result["error"],
                    duration_ms=int((time.monotonic() - t0) * 1000),
                )
            duration_ms = int((time.monotonic() - t0) * 1000)
            return RunSqlResponse(
                target=target.key,
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
            return RunSqlResponse(target=target.key, sql=req.sql, error=str(e), duration_ms=duration_ms)

    api_ask.__name__ = f"api_ask_{target.key}"
    api_generate_sql.__name__ = f"api_generate_sql_{target.key}"
    api_run_sql.__name__ = f"api_run_sql_{target.key}"

    app.post(f"{prefix}/ask", response_model=AskResponse, tags=["REST API"])(api_ask)
    app.post(f"{prefix}/generate_sql", response_model=GenerateSqlResponse, tags=["REST API"])(
        api_generate_sql
    )
    app.post(f"{prefix}/run_sql", response_model=RunSqlResponse, tags=["REST API"])(api_run_sql)


def main():
    llm = AnthropicLlmService(model=config.LLM_MODEL, api_key=config.ANTHROPIC_API_KEY)
    targets = build_targets()

    flowindex_agent = create_agent(
        llm=llm,
        system_prompt=targets["flowindex"].system_prompt,
        conninfo=config.FLOWINDEX_DATABASE_URL,
        search_path="app, raw, public",
    )

    app = VannaFastAPIServer(flowindex_agent).create_app()

    register_target_routes(app, "/api/v1/flowindex", targets["flowindex"])
    register_target_routes(app, "/api/v1/evm", targets["evm"])

    # Backwards-compatible aliases: default to FlowIndex.
    register_target_routes(app, "/api/v1", targets["flowindex"])

    @app.get("/api/v1/history", response_model=list[HistoryItem], tags=["REST API"])
    async def api_history(
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
        target: str | None = Query(None),
    ):
        return history.list(limit, offset, target)

    @app.get("/api/v1/history/{item_id}", response_model=HistoryItem, tags=["REST API"])
    async def api_history_item(item_id: str):
        item = history.get(item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Not found")
        return item

    @app.delete("/api/v1/history", tags=["REST API"])
    async def api_clear_history():
        history.items.clear()
        return {"status": "cleared"}

    print(f"Starting dual-target Vanna server on http://0.0.0.0:{config.PORT}")
    print(f"  Web UI:                 http://localhost:{config.PORT}")
    print(f"  FlowIndex ask:          http://localhost:{config.PORT}/api/v1/flowindex/ask")
    print(f"  FlowIndex generate_sql: http://localhost:{config.PORT}/api/v1/flowindex/generate_sql")
    print(f"  EVM ask:                http://localhost:{config.PORT}/api/v1/evm/ask")
    print(f"  EVM generate_sql:       http://localhost:{config.PORT}/api/v1/evm/generate_sql")
    print(f"  Legacy ask alias:       http://localhost:{config.PORT}/api/v1/ask")

    uvicorn.run(app, host=config.HOST, port=config.PORT)


if __name__ == "__main__":
    main()
