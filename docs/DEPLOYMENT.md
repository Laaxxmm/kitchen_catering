# Deployment — Railway

End-to-end runbook for shipping Greenpath to Railway. Repeat
the same steps for staging and production by creating two separate
services on Railway.

---

## 1. One-time Railway setup

1. **Create the project**
   - `railway init` or via the dashboard → New Project → Empty Project.
   - Give it a name (e.g. `green-park-eco-hotel`).

2. **Add Postgres**
   - In the project, click **+ New → Database → PostgreSQL**.
   - Wait ~30 s for it to provision. Railway will inject
     `DATABASE_URL` into anything that references it.

3. **Add the app service**
   - **+ New → GitHub repo** → pick this repo.
   - Railway detects the `Dockerfile` and `railway.json` automatically.
     The healthcheck path (`/api/health`) is already wired.

4. **Custom domain**
   - Service → **Settings** → **Networking** → **Generate domain** for a
     `*.up.railway.app` URL, OR **Custom Domain** for the real one.
   - The domain you set here MUST match `NEXTAUTH_URL` (next step).

---

## 2. Environment variables

Set these in **Railway → Service → Variables** tab. Anything marked
*required* will fail the boot with a clear message; the rest fall back
to sensible defaults.

### Required

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `${{ Postgres.DATABASE_URL }}` | Use the curly-brace reference syntax — Railway substitutes at runtime. |
| `AUTH_SECRET` | `<random 32+ chars>` | Generate via `openssl rand -base64 32`. Keep it secret. |
| `NEXTAUTH_URL` | `https://kitchen.greenpath.in` | Public origin. **Must include `https://`** and match the domain you set in step 1. |

### Optional but recommended

| Variable | When you need it |
|---|---|
| `NODE_ENV=production` | Always set on Railway. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Auto-send invoices via email. When unset, `lib/email.ts` falls back to console mode. |
| `EMAIL_FROM` | Friendly "From" header. Defaults to `Greenpath <SMTP_USER>`. |
| `SMS_PROVIDER=msg91` + `MSG91_AUTHKEY` | Production OTP delivery. Otherwise OTPs print to logs. |
| `INDEFINE_GSTIN` / `INDEFINE_ADDRESS` / `INDEFINE_BANK_DETAILS` | Override org-level constants used on invoice PDFs. |
| `EINVOICE_PROVIDER` + `CLEARTAX_API_KEY` + `CLEARTAX_GSP_GSTIN` | Live e-invoicing. Defaults to `nic-sandbox`. |
| `STORAGE_S3_*` | Cloud uploads. Without these, files go to `./public/uploads`. |
| `AI_ENABLED=true` + `ANTHROPIC_API_KEY` | Claude-backed features. |

### First deploy only

| Variable | Value | Notes |
|---|---|---|
| `SEED_DB` | `true` | On the very first deploy, set this to seed the eight default users (admin@, manager@, sales@, store@, chef@, delivery@, accounts@, housekeeping@, maintenance@) with password `changeme123`. **Unset it before the second deploy.** Re-running is idempotent but wastes ~10 s of boot time. |

---

## 3. Deploy

Push to the tracked branch (default `main`). Railway:

1. Builds the Docker image (`Dockerfile` → multi-stage).
2. Runs `docker-entrypoint.sh`:
   - Validates `DATABASE_URL` and `AUTH_SECRET` (length ≥ 32).
   - Applies migrations (`prisma migrate deploy`).
   - Optionally seeds (`tsx prisma/seed.ts` when `SEED_DB=true`).
   - Starts Next.js on `${PORT}` (Railway sets this).
3. Polls `/api/health` until 200 OK; promotes the deploy.

Watch **Deploy Logs** in the Railway dashboard — boot prints a clear
`[1/4]…[4/4]` progress trail.

---

## 4. Post-deploy verification

1. **Health check**
   ```
   curl https://<your-domain>/api/health
   ```
   Should return `{"status":"ok","db":"up","latencyMs":N}`.

2. **Login**
   - Go to `https://<your-domain>/login`.
   - If you set `SEED_DB=true`, log in as
     `admin@indefine.in` / `changeme123` and immediately change
     all eight default passwords via `/admin/users`.

3. **Smoke test**
   - Visit `/dashboard` — should render without 500s.
   - Create one test customer, one test order, one test housekeeping
     receipt. Confirm the audit log fills in (visible in `/reports`
     if exposed, or via Prisma Studio).

---

## 5. Custom domain / SSL

Railway provisions Let's Encrypt automatically for custom domains.
Steps:

1. Service → Settings → Networking → **Add Domain** → enter
   `kitchen.greenpath.in` (or whichever).
2. Add the CNAME Railway shows you to your DNS provider.
3. Wait 1–5 min for verification + cert issuance.
4. Update `NEXTAUTH_URL` to the new origin.
5. Trigger a redeploy so the env var takes effect.

---

## 6. Day-2 ops

### Schema changes

1. Develop locally with `npm run prisma:migrate` (creates a new
   migration in `prisma/migrations/`).
2. Commit the migration folder.
3. Push — Railway runs `prisma migrate deploy` on boot.

### Re-seeding a fresh user

- Use the in-app UI: log in as ADMIN → `/admin/users` → create.
- *Never* re-enable `SEED_DB=true` against a non-empty database for
  anything other than the defaults — the seed is intentionally limited
  to test scaffolding.

### Resetting transactional data (NEVER in production)

`npm run db:reset-transactional` exists for local dev. It refuses to
run when `NODE_ENV=production`.

### Rolling back

Railway → service → **Deployments** → click any older successful
deploy → **Redeploy**. Migrations are *additive only* in this codebase
(no destructive `down` migrations), so re-deploying an older image is
safe as long as the schema hasn't changed.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `FATAL: missing environment variables: DATABASE_URL` | Variable not set | Add `DATABASE_URL = ${{ Postgres.DATABASE_URL }}` to Variables tab |
| `FATAL: AUTH_SECRET is too short` | Used a value < 32 chars | Regenerate via `openssl rand -base64 32` |
| `prisma migrate deploy failed` | DB unreachable or migration drift | Check Postgres is on the same Railway project; inspect `_prisma_migrations` for FAILED rows |
| `502 Bad Gateway` for the first 30 s | Healthcheck hasn't passed yet | Wait — first cold start is slower while Prisma engine binds |
| `Invalid host header` after domain change | `NEXTAUTH_URL` mismatch | Update it and redeploy |
| Login redirects loop | `AUTH_SECRET` changed but cookies are stale | Clear browser cookies for the domain |

---

## 8. Cost expectations

| Plan tier | What you get | Roughly costs |
|---|---|---|
| **Hobby** | App service + 1 Postgres + free $5 credit/month | Free for low traffic |
| **Pro** | Higher CPU/RAM limits, priority builds | ~$5 + usage |

The Docker image is ~700 MB, build time ~3–5 min, cold start ~20–30 s
once tini hands off to Next.js.

---

## 9. Local development quickstart

```bash
# 1. Postgres locally (Windows installer / docker / homebrew)
createdb indefine_kitchen

# 2. Copy env template
cp .env.example .env
# Fill in DATABASE_URL + AUTH_SECRET at minimum

# 3. Install + migrate + seed
npm install
npm run prisma:migrate
npm run db:seed

# 4. Dev server
npm run dev    # http://localhost:3000
```

Available scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run verify` | typecheck + lint (CI-friendly) |
| `npm run env:check` | Validate `.env` against the Zod schema |
| `npm run prisma:migrate` | Create + apply a new dev migration |
| `npm run prisma:migrate:deploy` | Apply pending migrations (CI / prod) |
| `npm run prisma:studio` | Browse the DB at localhost:5555 |
| `npm run db:seed` | Re-run the seed script (idempotent) |
