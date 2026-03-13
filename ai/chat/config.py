"""Configuration for FlowIndex AI chat service."""

import os
from dotenv import load_dotenv

load_dotenv()

# --- Databases (read-only connections) ---

# Flowindex DB (Cadence + native Flow data)
FLOWINDEX_DATABASE_URL = os.environ.get(
    "FLOWINDEX_DATABASE_URL",
    os.environ.get("DATABASE_URL", "postgresql://flowscan:secretpassword@localhost:5432/flowscan"),
)

# Flow EVM Blockscout DB (EVM data)
BLOCKSCOUT_DATABASE_URL = os.environ.get(
    "BLOCKSCOUT_DATABASE_URL",
    "",
)

# Statement timeout for generated queries (seconds)
QUERY_TIMEOUT_S = int(os.environ.get("QUERY_TIMEOUT_S", "30"))

# Maximum rows returned per query
MAX_RESULT_ROWS = int(os.environ.get("MAX_RESULT_ROWS", "500"))

# --- LLM ---
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "anthropic")  # anthropic | openai
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "claude-sonnet-4-5-20250929")

# --- ChromaDB persistence ---
CHROMA_PERSIST_DIR = os.environ.get("CHROMA_PERSIST_DIR", "./chroma_data")

# --- Server ---
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8084"))
MCP_PORT = int(os.environ.get("MCP_PORT", "8085"))
VANNA_BASE_URL = os.environ.get("VANNA_BASE_URL", f"http://127.0.0.1:{PORT}").rstrip("/")
VANNA_API_TOKEN = os.environ.get("VANNA_API_TOKEN", "")

# --- Security ---
# Optional bearer token for API auth
API_TOKEN = os.environ.get("API_TOKEN", "")

# --- MCP Auth ---
MCP_ADMIN_KEY = os.environ.get("MCP_ADMIN_KEY", "")
MCP_AUTH_ENABLED = os.environ.get("MCP_AUTH_ENABLED", "true").lower() in ("true", "1", "yes")
MCP_RATE_LIMIT = int(os.environ.get("MCP_RATE_LIMIT", "60"))  # requests per minute per key
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8080")  # Go backend for key validation
