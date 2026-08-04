# Greenpath — multi-stage build for Railway.
#
#   deps    → install npm deps + generate Prisma client (cached layer)
#   builder → compile Next.js + Tailwind
#   runner  → Node 20 alpine + full node_modules + the compiled .next
#             output. The entrypoint validates env, runs `prisma migrate
#             deploy`, optionally seeds, then `next start`.
#
# Why not `output: "standalone"`?  The seed script + Prisma CLI + tsx
# all need to run at container start. Trying to cherry-pick those deps
# out of the standalone bundle is fragile; the size win isn't worth it
# for an internal-facing app.

# ============================================================================
# 1. deps — install once, cache between rebuilds
# ============================================================================
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Lockfile + schema (the Prisma postinstall runs `prisma generate`).
# .npmrc must ride along: it carries legacy-peer-deps=true, without which
# npm ci ERESOLVEs on next-auth's peerOptional nodemailer<=8 vs our
# patched nodemailer 9 (this exact miss broke every deploy 29 Jul–4 Aug).
COPY package.json package-lock.json* .npmrc ./
COPY prisma ./prisma

RUN npm ci

# ============================================================================
# 2. builder — compile Next.js
# ============================================================================
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env. Real values come from Railway at runtime.
# DATABASE_URL must parse as a valid Postgres URL even though we don't
# connect to the DB during build.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL="postgresql://build:build@build:5432/build?schema=public"
ENV AUTH_SECRET="build-time-placeholder-replace-at-runtime-32+chars"
ENV NEXTAUTH_SECRET="build-time-placeholder-replace-at-runtime-32+chars"

RUN npx prisma generate
RUN npm run build

# ============================================================================
# 3. runner — production runtime image
# ============================================================================
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl tini
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nextjs

# Bring the full built app over. node_modules is large but every dep is
# already needed somewhere (Prisma CLI, tsx for seed, nodemailer, etc.).
COPY --from=builder --chown=nextjs:nodejs /app/.next            ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma           ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules     ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/scripts          ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/env.ts   ./src/lib/env.ts
COPY --from=builder --chown=nextjs:nodejs /app/package.json     ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.mjs  ./next.config.mjs
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json    ./tsconfig.json

# Entrypoint. .gitattributes pins LF; `sed` is defensive belt-and-braces
# for Windows clones that might smuggle CRLF through.
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 8080

# `tini` adopts PID 1 + forwards signals so graceful shutdown works.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "/app/docker-entrypoint.sh"]
