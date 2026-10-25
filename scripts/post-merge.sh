#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run setup:higgsfield
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/src/apply-approved-photo-pricing.sql
