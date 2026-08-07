import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/rbac";

/**
 * Server-side helpers for the action result contract (see
 * `@/lib/action-result` for the client-safe types and the rationale).
 * Actions wrap their body in `try { … } catch (err) { return
 * actionFailure(err) }` and return `{ ok: true, … }` on success.
 */
export type { ActionResult, ActionResultWith } from "@/lib/action-result";

/** Business-rule failure whose message is safe to show the user. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

function isNextControlFlowError(err: unknown): boolean {
  // redirect()/notFound() throw control-flow errors that must propagate.
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_")
  );
}

export function actionFailure(err: unknown): { ok: false; error: string } {
  if (isNextControlFlowError(err)) throw err;
  // decimal.js signals a blank/garbage string reaching the money math by
  // throwing a PLAIN `Error` whose MESSAGE carries the marker — it does not
  // set `err.name` and it is not a subclass. That makes it indistinguishable
  // by shape from the deliberate `new Error("…")` messages below, so this has
  // to run FIRST: the passthrough would otherwise claim it and leak
  // "[DecimalError] Invalid argument: " to the user, which is exactly what
  // shipped (blank petty-cash voucher / top-up amounts, among others).
  if (err instanceof Error && (err.name === "DecimalError" || err.message.startsWith("[DecimalError]"))) {
    return {
      ok: false,
      error: "One of the number fields isn't a valid number — check quantities, prices and GST %.",
    };
  }
  if (
    err instanceof ActionError ||
    err instanceof AuthorizationError ||
    err instanceof AuthenticationError ||
    // Plain `new Error("…")` (not subclasses like TypeError) is used across
    // the actions for deliberate user-facing messages — pass those through.
    (err instanceof Error && err.constructor === Error)
  ) {
    return { ok: false, error: err.message };
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    if (!first) return { ok: false, error: "Invalid input" };
    // Show the human field name, not the raw Zod path: "lines.0.requestedQty"
    // → "requested qty". Take the last string segment (skip array indices),
    // split camelCase into spaced lowercase words.
    const segments = first.path.filter((p): p is string => typeof p === "string");
    const label = segments.length
      ? segments[segments.length - 1].replace(/([A-Z])/g, " $1").toLowerCase().trim()
      : "";
    return {
      ok: false,
      error: label ? `${label}: ${first.message}` : first.message,
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return { ok: false, error: "A record with these details already exists." };
    }
    if (err.code === "P2025") {
      return { ok: false, error: "That record no longer exists — refresh and try again." };
    }
  }
  console.error("[action] unexpected failure:", err);
  return { ok: false, error: "Something went wrong on the server. Please try again." };
}
