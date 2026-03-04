# Scripts — Utility Scripts

> Part of the [FlowIndex](../CLAUDE.md) monorepo. See root CLAUDE.md for full architecture and deployment details.

## Overview

Ad-hoc utility scripts for data validation, API comparison, deployment, and backfill operations.

## Scripts

- `audit_api_fields.py` — Audit API response fields for completeness
- `compare_api.py` — Compare API responses between environments
- `cross_validate_flow_fees.py` — Cross-validate Flow transaction fees
- `backfill-staking-payouts.sh` — Backfill staking payout data
- `deploy-sim-studio-local.sh` — Local deployment for sim-workflow studio

## Usage

Most scripts are standalone and document their own usage. Python scripts require standard data science deps (requests, etc.).
