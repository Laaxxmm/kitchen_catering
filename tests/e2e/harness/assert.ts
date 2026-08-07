import { expect } from "vitest";
import { AuthenticationError, AuthorizationError } from "@/server/rbac";

/**
 * Reading action results. The house contract is that an expected failure
 * comes back as `{ok:false, error}` rather than throwing — but the RBAC
 * guards throw, and `actionFailure` only catches them when the action wraps
 * its body. Both shapes count as a refusal; neither counts as success.
 */

type Failure = { ok: false; error: string };
type Success<T> = { ok: true } & T;

/**
 * Unwrap a successful action result, or fail the test with the server's own
 * error message. Use this everywhere instead of `result as {id: string}` —
 * a refused action then reads as "create dish: vendor not found", not as
 * `undefined is not an object`.
 */
export function mustOk<T extends object>(
  result: Success<T> | Failure,
  what: string,
): Success<T> {
  if (!result.ok) {
    throw new Error(`${what} was refused: ${result.error}`);
  }
  return result;
}

/**
 * Assert an action refuses. Returns the refusal message so a caller can go
 * on to assert WHY — a permission test that passes because the action blew
 * up on a typo'd id is worth nothing.
 *
 * Accepts either contract: `{ok:false}` or a thrown Authorization/
 * Authentication error (an ungated read helper such as `listOrders` throws
 * straight out of requireRole).
 */
export async function expectRefused(
  fn: () => Promise<{ ok: boolean; error?: string } | unknown>,
): Promise<string> {
  let result: unknown;
  try {
    result = await fn();
  } catch (err) {
    if (err instanceof AuthorizationError || err instanceof AuthenticationError) {
      return err.message;
    }
    throw err;
  }
  if (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    (result as { ok: unknown }).ok === false
  ) {
    return String((result as { error?: unknown }).error ?? "");
  }
  expect.unreachable(
    `Expected the action to be refused, but it succeeded with ${JSON.stringify(result)}`,
  );
}

/** Decimal columns come back as Prisma.Decimal; compare them as strings. */
export function decimalEquals(
  actual: { toString(): string } | null | undefined,
  expected: string,
): boolean {
  if (actual == null) return false;
  return Number(actual.toString()) === Number(expected);
}

/** `expect(onHand).toEqual(qty("22.000"))` reads worse than this. */
export function expectDecimal(
  actual: { toString(): string } | null | undefined,
  expected: string,
  what = "value",
): void {
  expect(
    { [what]: actual == null ? null : Number(actual.toString()) },
  ).toEqual({ [what]: Number(expected) });
}
