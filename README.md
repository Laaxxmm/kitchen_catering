# Greenpath — catering operations

Internal ERP for a catering business: orders → kitchen → delivery → invoice →
payment, with procurement, three stock rooms, petty cash, salary and reporting
around it. Live in production with a real team. Next.js 15 (App Router) ·
Prisma 6 · PostgreSQL · NextAuth v5 (JWT) · Railway.

- **Deploying and operating it:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **Where it stands security-wise:** [AUDIT_REPORT.md](AUDIT_REPORT.md)
- **Design notes:** [docs/design-brief.md](docs/design-brief.md)

## Where things live

```
src/
  middleware.ts              signed-in? then route → role map (lib/route-access.ts)
  lib/                       pure decisions, no I/O — *-gates.ts, order-status.ts,
                             stock-health.ts, money.ts, validators.ts. Unit-tested.
  server/
    rbac.ts                  requireRole / requireSession / gateRolePage
    actions/                 every mutation. One file per module; the two biggest
                             (orders, procurement) are a barrel + one file per
                             lifecycle stage:
                               orders/      create · approve · revise · close · read
                               procurement/ po · grn · bills · advances · read
                             _shared.ts in each holds helpers, never actions.
    *-core.ts                transaction-level logic two actions share
    reports/                 reads that compute (stock ledger, stock health)
    services/                outbound integrations (e-invoice)
  app/(dashboard)/           one folder per module, page.tsx + _components/
  app/api/                   exports, PDFs, mobile bearer API, cron, health
tests/
  unit/                      the pure lib, fast, no database
  e2e/                       real actions against real Postgres, one file per flow;
                             access/matrix.test.ts is the permission ledger
prisma/migrations/           hand-written SQL, applied by the container on boot
```

## The rules the code follows

They are not optional — the tests assume them.

1. **Every mutation returns `{ ok: true, … } | { ok: false, error }`** via
   `actionFailure` / `ActionError`. Never throw for an expected failure: Next
   masks thrown messages in production and the user sees "Server Components
   render error".
2. **Every action gates itself** with `requireRole` / `requireSession`, whatever
   the middleware already did. `tests/e2e/access/matrix.test.ts` proves each
   action admits exactly the desks it should and fails the build if a new one
   is not registered. Inline `"use server"` functions in pages must delegate
   to a gated action; `tests/unit/inline-actions-gated.test.ts` checks.
3. **State transitions are status-guarded `updateMany` + count check**, not
   find-then-update. Two people press the same button.
4. **Stock and money read-modify-write takes a `FOR UPDATE` row lock**
   (`lockIngredientRow`, `lockBanquetItemRows`, `lockFloatRow`). Money is
   `Decimal`, never a float. `decimalString` admits `""` — blank-guard before
   `new Decimal()`.
5. **Slow side-work goes through `deferAfterResponse`** — notifications,
   email, PDFs — after the transaction commits, never awaited before the
   response.
6. **Sessions are revocable.** `User.sessionVersion` is stamped into the JWT;
   `requireSession` re-reads the row on every call. Deactivate, role change and
   password change bump it and end the session on the next click.
7. **Decisions live in `src/lib` as pure functions with unit tests**; actions
   call them. If a rule is worth arguing about, it is worth a test that fails
   without it.
8. **Migrations are hand-written SQL** in `prisma/migrations`, applied by
   `prisma migrate deploy` at container boot. Never `db push` against
   production.

## Running it

```bash
cp .env.example .env            # fill DATABASE_URL and AUTH_SECRET at minimum
npm install
npx prisma migrate deploy
npm run dev
```

Tests:

```bash
npm test                        # unit, ~3s
DATABASE_URL=postgresql://postgres:e2e@127.0.0.1:5540/kc_e2e npm run test:e2e
```

The e2e suite drops and re-seeds the database it points at. Point it at a
throwaway Postgres — `docker run -d -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=kc_e2e -p 5540:5432 postgres:16` —
never at anything you care about. Before a push: `npx tsc --noEmit --incremental false`
(plain `--noEmit` can give a false green when a stale build cache is around),
`npm test`, the e2e suite, `npm run build`.

## Go-live and resets

Admin → Settings holds the reset tools. **Erase everything** wipes all
transactional data and both catalogues, keeping users, customers, vendors and
the dish menu; **Import catalogue** loads the client's item lists from
`data/catalogue/`. Run them in that order. There is no undo and no backup
inside the app.
