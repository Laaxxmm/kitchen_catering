#!/bin/sh
# Green Park Eco Hotel — container entrypoint.
#
# Boot order:
#   1. validate critical env vars (shell — catches missing values fast)
#   2. apply DB migrations (prisma migrate deploy)
#   3. optionally seed default users (SEED_DB=true — first deploy only)
#   4. start Next.js
#
# Fails loud and fast with a clear message on any step, so Railway's
# Deploy Logs pinpoint the problem instead of a generic crashloop.

set -e

PORT="${PORT:-8080}"
HOSTNAME="${HOSTNAME:-0.0.0.0}"

echo "============================================================"
echo "  Green Park Eco Hotel — container boot"
echo "------------------------------------------------------------"
echo "  NODE_ENV     = ${NODE_ENV:-development}"
echo "  PORT         = ${PORT}"
echo "  HOSTNAME     = ${HOSTNAME}"
echo "  NEXTAUTH_URL = ${NEXTAUTH_URL:-<default>}"
echo "  DATABASE_URL    $([ -n "${DATABASE_URL}"     ] && echo set || echo MISSING)"
echo "  AUTH_SECRET     $([ -n "${AUTH_SECRET}"      ] && echo set || echo MISSING)"
echo "  SEED_DB      = ${SEED_DB:-false}"
echo "============================================================"

# ---- 1/4 env validation ----
echo "[1/4] Validating critical environment variables"
MISSING=""
[ -z "${DATABASE_URL}" ] && MISSING="${MISSING} DATABASE_URL"
[ -z "${AUTH_SECRET}"  ] && MISSING="${MISSING} AUTH_SECRET"
if [ -n "${MISSING}" ]; then
  echo "FATAL: missing environment variables:${MISSING}"
  echo "       Set them in Railway → service → Variables tab."
  echo "       For DATABASE_URL use the reference syntax:"
  echo "         DATABASE_URL = \${{ Postgres.DATABASE_URL }}"
  echo "       For AUTH_SECRET generate via:  openssl rand -base64 32"
  exit 1
fi
SECRET_LEN=$(printf '%s' "${AUTH_SECRET}" | wc -c | tr -d ' ')
if [ "${SECRET_LEN}" -lt 32 ]; then
  echo "FATAL: AUTH_SECRET is too short (${SECRET_LEN} chars). Needs at least 32."
  echo "       Generate via:  openssl rand -base64 32"
  exit 1
fi
echo "      OK"
echo

# ---- 2/4 migrations ----
echo "[2/4] Applying Prisma migrations"
node node_modules/prisma/build/index.js migrate deploy
echo

# ---- 3/4 optional seed ----
if [ "${SEED_DB}" = "true" ]; then
  echo "[3/4] SEED_DB=true — running prisma/seed.ts (one-shot)"
  # Seed is idempotent (upserts) so re-runs are safe. We still don't
  # fail the boot if it errors — that way a stale SEED_DB=true flag
  # can't bring the site down.
  if ! node node_modules/tsx/dist/cli.mjs prisma/seed.ts; then
    echo "    Seed exited non-zero. Continuing — likely already seeded."
  fi
  echo
else
  echo "[3/4] SEED_DB!=true — skipping seed (normal for redeploys)"
  echo
fi

# ---- 4/4 server ----
echo "[4/4] Starting Next.js on ${HOSTNAME}:${PORT}"
exec node node_modules/next/dist/bin/next start --hostname "${HOSTNAME}" --port "${PORT}"
