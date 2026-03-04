# Studio — Supabase Studio Proxy

> Part of the [FlowIndex](../CLAUDE.md) monorepo. See root CLAUDE.md for full architecture and deployment details.

## Overview

Nginx-based proxy for Supabase Studio with custom login page and auth handling. Provides a web UI for database management.

## Structure

```
studio/
├── nginx.conf              # Proxy configuration
├── login.html              # Custom login page
├── entrypoint.sh           # Container startup script
├── seed/                   # Database seed data
├── Dockerfile
└── FORK_INTEGRATION.md     # Integration notes
```

## Access

- Local: `http://localhost:8000`
- Uses `studio-auth` container for authentication
