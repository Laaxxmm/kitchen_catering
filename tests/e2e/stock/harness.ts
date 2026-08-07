/**
 * The shared e2e harness, re-exported behind the database redirect, plus the
 * Prisma client itself so no scenario here has to import `@/server/db`
 * directly (that import is exactly the one that must not run first).
 *
 * The few openings below are the ones every stock scenario opens with — an
 * issue to return against, a declaration to confirm — composed only of real
 * server actions, same rule as tests/e2e/harness/flows.ts.
 */
import "./db-url";

import {
  declareIngredientReturn,
  recordDirectIngredientIssue,
} from "@/server/actions/inventory";
import { db } from "@/server/db";
import { asChef, asStore } from "../harness/session";
import { mustOk } from "../harness/assert";
import { istInput } from "../harness/flows";

export * from "../harness";
export { db } from "@/server/db";

/**
 * A catalogue line no other scenario in this file has touched, with no
 * opening stock — so a test can assert absolute on-hand figures without
 * resetting the database between tests. Handed out in SKU order, one per
 * caller.
 */
let spares: string[] | null = null;
let handedOut = 0;
export async function spareIngredient(): Promise<string> {
  spares ??= (
    await db.ingredient.findMany({
      where: { active: true, openingQty: 0 },
      orderBy: { sku: "asc" },
      take: 40,
      select: { id: true },
    })
  ).map((r) => r.id);
  const id = spares[handedOut++];
  if (!id) throw new Error("Ran out of untouched catalogue lines — did the import run?");
  return id;
}

/** The store issues stock to an order. Returns the issue id a return points at. */
export async function issueStock(
  orderId: string,
  ingredientId: string,
  qty: string,
): Promise<string> {
  asStore();
  return mustOk(
    await recordDirectIngredientIssue({ ingredientId, orderId, qty }),
    `issue ${qty}`,
  ).id;
}

/** The chef declares a return against one issue. Returns the document id and
 *  its single line id (what the store's confirmation answers). */
export async function declareReturn(
  issueId: string,
  quantity: string,
  reason = "unused at the event",
): Promise<{ id: string; lineId: string }> {
  asChef();
  const { id } = mustOk(
    await declareIngredientReturn({
      returnedAt: istInput(new Date()),
      lines: [{ issueId, quantity, reason }],
    }),
    `declare ${quantity}`,
  );
  const line = await db.ingredientReturnLine.findFirstOrThrow({
    where: { returnId: id },
    select: { id: true },
  });
  return { id, lineId: line.id };
}
