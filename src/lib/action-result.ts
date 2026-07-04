/**
 * Result contract for server actions — client-safe (no server imports).
 *
 * In production Next.js masks the message of any error thrown inside a
 * server action, so expected business failures ("order already approved",
 * "duplicate SKU", validation) travel back to the client as data. Client
 * components check `res.ok` and toast `res.error` when false.
 *
 * Server-side helpers (ActionError, actionFailure) live in
 * `@/server/action-result`.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionResultWith<T> = ({ ok: true } & T) | { ok: false; error: string };
