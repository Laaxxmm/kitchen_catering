/**
 * Detect Next.js's internal "I am redirecting" or "not found" signals.
 *
 * Server actions that call `redirect()` or `notFound()` throw a special
 * error that the framework intercepts at the action boundary to perform
 * the navigation. If client code wraps the action call in a try/catch
 * and surfaces the error via `toast.error(err.message)`, the user sees a
 * literal "NEXT_REDIRECT" toast — the navigation has already happened.
 *
 * Use this helper in every form's catch block:
 *
 *   try { await onSubmit(...); }
 *   catch (err) {
 *     if (isNextNavigationError(err)) throw err;  // let Next handle it
 *     toast.error(err instanceof Error ? err.message : "Save failed");
 *   }
 */
export function isNextNavigationError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.message === "NEXT_REDIRECT" || err.message === "NEXT_NOT_FOUND") return true;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}
