#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Rebuild generated contracts before workflows start using newly merged fields.
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run setup:higgsfield
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/src/apply-approved-photo-pricing.sql
