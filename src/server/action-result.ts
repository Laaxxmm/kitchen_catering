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
    return {
      ok: false,
      error: first
        ? `${first.path.length ? `${first.path.join(".")}: ` : ""}${first.message}`
        : "Invalid input",
    };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = Array.isArray(err.meta?.target) ? (err.meta.target as string[]).join(", ") : "value";
      return { ok: false, error: `Already exists — another record uses the same ${target}.` };
    }
    if (err.code === "P2025") {
      return { ok: false, error: "That record no longer exists — refresh and try again." };
    }
  }
  console.error("[action] unexpected failure:", err);
  return { ok: false, error: "Something went wrong on the server. Please try again." };
}
