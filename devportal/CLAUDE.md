# DevPortal — Developer Portal

> Part of the [FlowIndex](../CLAUDE.md) monorepo. See root CLAUDE.md for full architecture and deployment details.

## Overview

Developer documentation portal built with Fumadocs (Next.js-based) + Scalar for API reference. Provides API docs, guides, and interactive API explorer.

## Structure

```
devportal/
├── app/                    # Next.js app router
├── components/             # UI components
├── lib/                    # Utilities
├── mdx-components.tsx      # MDX component overrides
├── next.config.mjs
├── Dockerfile
└── package.json
```

## Commands

```bash
bun install
bun run dev          # Dev server
bun run build        # Production build (uses --webpack flag)
bun run start        # Start production server
bun run types:check  # TypeScript check
```

## Key Dependencies

- `fumadocs-core` / `fumadocs-ui` / `fumadocs-mdx` — Documentation framework
- `fumadocs-openapi` — OpenAPI integration
- `@scalar/api-reference-react` — Interactive API reference
- `next` 16.x — Framework
