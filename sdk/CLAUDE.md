# SDK — FlowIndex Webhooks SDK

> Part of the [FlowIndex](../CLAUDE.md) monorepo. See root CLAUDE.md for full architecture and deployment details.

## Overview

TypeScript SDK (`@flowscan/webhooks-sdk`) for consuming FlowIndex webhook event notifications.

## Structure

```
sdk/
└── typescript/
    ├── src/            # Source code
    ├── package.json
    └── tsconfig.json
```

## Commands

```bash
cd sdk/typescript
bun install
bun run build    # TypeScript compilation (outputs to dist/)
bun run test     # Vitest
```
