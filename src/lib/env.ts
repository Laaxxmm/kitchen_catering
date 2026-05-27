import { z } from "zod";

/**
 * Centralised environment-variable validation.
 *
 * Why this file exists:
 *   - Catches missing or malformed env vars at module-load time with a
 *     clear error message naming the field, instead of silently breaking
 *     a server action three pages deep.
 *   - Documents every variable the runtime reads from `process.env.*` in
 *     one place. Keep this in sync with `.env.example`.
 *
 * Import `env` (NOT `process.env`) anywhere you need a config value. The
 * shape is statically typed; misspellings fail at compile time.
 *
 * The schema is permissive on optional fields so the app still boots when
 * non-critical integrations (email, SMS, e-invoice) are unconfigured;
 * the corresponding modules fall back to dev-friendly "console mode".
 */

const schema = z.object({
  // ─── Core (required everywhere) ──────────────────────────────────
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required (Postgres connection string)")
    .refine(
      (v) => v.startsWith("postgres://") || v.startsWith("postgresql://"),
      "DATABASE_URL must be a postgres:// or postgresql:// URL",
    ),
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 chars (use `openssl rand -base64 32`)"),
  // Fallback alias read by older next-auth tooling. Accept either.
  NEXTAUTH_SECRET: z.string().optional(),
  NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),

  // ─── App ─────────────────────────────────────────────────────────
  APP_TZ: z.string().default("Asia/Kolkata"),
  PORT: z.coerce.number().default(3000),
  HOSTNAME: z.string().default("0.0.0.0"),

  // ─── Org metadata (optional overrides) ───────────────────────────
  INDEFINE_STATE_CODE: z.string().regex(/^[0-9]{2}$/).default("29"),
  INDEFINE_GSTIN: z.string().optional(),
  INDEFINE_ADDRESS: z.string().optional(),
  INDEFINE_BANK_DETAILS: z.string().optional(),
  INDEFINE_LOGO_URL: z.string().optional(),
  INDEFINE_COMPANY_NAME: z.string().optional(),

  // ─── Storage (S3 optional) ───────────────────────────────────────
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  UPLOAD_ROOT: z.string().optional(),

  // ─── SMS ─────────────────────────────────────────────────────────
  SMS_PROVIDER: z.enum(["console", "msg91"]).default("console"),
  MSG91_AUTHKEY: z.string().optional(),

  // ─── Email (SMTP) ────────────────────────────────────────────────
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_LOG_BODY: z.string().optional(),

  // ─── E-invoicing ─────────────────────────────────────────────────
  EINVOICE_PROVIDER: z.enum(["nic-sandbox", "cleartax"]).default("nic-sandbox"),
  CLEARTAX_API_KEY: z.string().optional(),
  CLEARTAX_GSP_GSTIN: z.string().optional(),

  // ─── FCM push ────────────────────────────────────────────────────
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),

  // ─── Deployment flags ────────────────────────────────────────────
  // Set SEED_DB=true on Railway only for the very first deploy. The
  // docker-entrypoint runs `tsx prisma/seed.ts` and creates the seven
  // default users. Leave UNSET on subsequent deploys.
  SEED_DB: z.string().optional(),

  // ─── Cron (vendor payment reminder, Phase 5) ────────────────────
  // Set when you wire a Railway cron service hitting
  // /api/cron/vendor-reminders. Generate via openssl rand -base64 32.
  CRON_SECRET: z.string().optional(),

  // ─── AI integrations (optional) ──────────────────────────────────
  AI_ENABLED: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL_DEFAULT: z.string().optional(),
  AI_MODEL_FAST: z.string().optional(),
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // Fail loud and early — same shape as the entrypoint's manual checks
    // so logs are consistent.
    throw new Error(
      `\n[env] Invalid or missing environment variables:\n${issues}\n` +
        `Fix the values above (see .env.example) and restart.\n`,
    );
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;
