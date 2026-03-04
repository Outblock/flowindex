# AI — FlowIndex AI Chat Assistant

> Part of the [FlowIndex](../CLAUDE.md) monorepo. See root CLAUDE.md for full architecture and deployment details.

## Overview

AI chat assistant for Flow blockchain queries. Python backend with a Next.js web frontend.

## Structure

```
ai/
└── chat/
    ├── server.py           # Python FastAPI/Flask server
    ├── mcp_server.py       # MCP server for tool integration
    ├── client.py           # Client utilities
    ├── config.py           # Configuration
    ├── db.py               # Database layer
    ├── train.py            # Training data processing
    ├── training_data/      # Training datasets
    ├── web/                # Next.js web frontend
    ├── requirements.txt    # Python dependencies
    ├── Dockerfile
    └── nginx.conf
```

## Commands

```bash
cd ai/chat

# Python backend
pip install -r requirements.txt
python server.py

# Web frontend
cd web
bun install
bun run dev
```
