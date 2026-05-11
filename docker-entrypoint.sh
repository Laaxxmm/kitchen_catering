#!/bin/sh
# SAB India Tracker — container entrypoint.
# `set -x` traces every command to stderr so Railway's Deploy Logs tab
# shows exactly what the container is doing line-by-line. Remove later
# once boot is reliable.

# Print a sentinel BEFORE anything else, to both stdout and stderr,
# so we can tell whether the script was ever exec'd vs. the runtime
# refusing to start the container at all.
echo "=== SAB ENTRYPOINT REACHED ==="
echo "=== SAB ENTRYPOINT REACHED ===" 1>&2

set -ex

PORT="${PORT:-8080}"

echo "============================================================"
echo "  SAB India Tracker — boot"
echo "============================================================"
echo "  NODE_ENV  = ${NODE_ENV:-<unset>}"
echo "  PORT      = ${PORT}"
echo "  HOSTNAME  = ${HOSTNAME:-<unset>}"
echo "  PWD       = $(pwd)"
echo "  whoami    = $(whoami)"
echo "  id        = $(id)"
echo "  node      = $(node --version 2>&1 || echo MISSING)"
echo "  files in /app:"
ls -la /app | head -20
echo "  DATABASE_URL is $([ -n "${DATABASE_URL}" ] && echo SET || echo UNSET)"
echo "  NEXTAUTH_SECRET is $([ -n "${NEXTAUTH_SECRET}" ] && echo SET || echo UNSET)"
echo "  AUTH_SECRET is $([ -n "${AUTH_SECRET}" ] && echo SET || echo UNSET)"
echo "  NEXTAUTH_URL = ${NEXTAUTH_URL:-<unset>}"
echo "  SEED_DB   = ${SEED_DB:-<unset>}"
echo "  AI_ENABLED = ${AI_ENABLED:-<unset>}  (must be exactly 'true' to enable AI)"
echo "  ANTHROPIC_API_KEY is $([ -n "${ANTHROPIC_API_KEY}" ] && echo SET || echo UNSET)"
echo "  AI_MODEL_DEFAULT = ${AI_MODEL_DEFAULT:-<unset>}"
echo "  AI_MODEL_FAST = ${AI_MODEL_FAST:-<unset>}"
echo "============================================================"

if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL is not set."
  echo "       In Railway service Variables, set:"
  echo "         DATABASE_URL = \${{ Postgres.DATABASE_URL }}"
  echo "       (with the curly-brace reference syntax — Railway expands it)"
  exit 1
fi

# Disable -e for migrations so we can print our own message on failure.
set +e
echo "==> [1/3] prisma migrate deploy"
node node_modules/prisma/build/index.js migrate deploy
MIGRATE_RC=$?
set -e
if [ "$MIGRATE_RC" -ne 0 ]; then
  echo "FATAL: prisma migrate deploy failed (rc=$MIGRATE_RC)"
  echo "       See the Prisma error above. Common causes:"
  echo "       - DATABASE_URL host unreachable from this container"
  echo "       - DB user lacks CREATE/ALTER permissions"
  echo "       - _prisma_migrations table left dirty by a previous failed deploy"
  exit 1
fi

if [ "$SEED_DB" = "true" ]; then
  echo "==> [2/3] SEED_DB=true -> running prisma/seed.ts"
  set +e
  node node_modules/tsx/dist/cli.mjs prisma/seed.ts
  SEED_RC=$?
  set -e
  if [ "$SEED_RC" -ne 0 ]; then
    echo "    Seed exited rc=$SEED_RC. Continuing — likely already seeded."
  fi
else
  echo "==> [2/3] skipping seed (SEED_DB != true)"
fi

echo "==> [3/3] next start on 0.0.0.0:${PORT}"
# Bypass npm — call next directly so no script arg parsing can interfere.
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "$PORT"
