import "./db-url";

import { beforeAll, describe, expect, it } from "vitest";
import { listStockHealth } from "@/server/actions/inventory";
import {
  asManager,
  asStore,
  db,
  ensureSeeded,
  issueStock,
  placeCateringOrder,
  seeded,
  spareIngredient,
  stockUp,
} from "./harness";

/**
 * The stock screen's headline, against real movements.
 *
 * It used to read "out of stock" off one rule — on hand ≤ 0 — which after
 * the catalogue import meant ~285 of 405 items, none of them a shortage.
 * The store stopped believing the number and went back to counting shelves.
 * What these pin is the separation: an item that has genuinely run out and
 * is genuinely used sits in the headline; one nobody has ever drawn does
 * not, whatever its stock says.
 */

const find = (rows: Awaited<ReturnType<typeof listStockHealth>>, id: string) =>
  rows.find((r) => r.id === id);

beforeAll(async () => {
  await ensureSeeded();
});

describe("what the store is shown", () => {
  it("leaves an untouched catalogue item out of the shortage count", async () => {
    const id = await spareIngredient();
    await asStore();
    const row = find(await listStockHealth(), id);
    // Zero on hand, but nothing has ever been drawn — not an order.
    expect(row?.onHand).toBe("0");
    expect(row?.bucket).toBe("NEVER_USED");
    expect(row?.suggestedQty).toBe("0");
  });

  it("counts an item that ran out AND is being used", async () => {
    const id = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(id, "10", "10");
    // Draw the lot: on hand back to zero, but now with a usage history.
    await issueStock(order.id, id, "10");

    await asStore();
    const row = find(await listStockHealth(), id);
    expect(row?.onHand).toBe("0");
    expect(row?.bucket).toBe("OUT_NEEDED");
  });

  it("works out how much to buy from the rate, not from a hand-set level", async () => {
    const id = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(id, "100", "10");
    await issueStock(order.id, id, "70");

    await asStore();
    const row = find(await listStockHealth(), id);
    // Everything moved today, so the rate is the whole 70 over one day and
    // 30 left is well under a week of cover.
    expect(row?.bucket).toBe("RUNNING_OUT");
    expect(Number(row?.suggestedQty)).toBeGreaterThan(0);
    // No reorder level was ever set — the old screen would have said nothing.
    expect(row?.reorderLevel).toBe("0");
  });

  it("keeps a hand-set reorder level in charge where someone set one", async () => {
    const id = await spareIngredient();
    const order = await placeCateringOrder();
    await stockUp(id, "100", "10");
    await issueStock(order.id, id, "1");
    await db.ingredient.update({ where: { id }, data: { reorderLevel: "150" } });

    await asStore();
    // 99 on hand at 1/day is months of cover, but the level says restock.
    expect(find(await listStockHealth(), id)?.bucket).toBe("RUNNING_OUT");
  });

  it("does not report hidden items at all", async () => {
    const id = await spareIngredient();
    await asManager();
    await db.ingredient.update({ where: { id }, data: { active: false } });
    await asStore();
    expect(find(await listStockHealth(), id)).toBeUndefined();
  });

  it("covers the whole active catalogue exactly once", async () => {
    await asStore();
    const rows = await listStockHealth();
    const active = await db.ingredient.count({ where: { active: true } });
    expect(rows).toHaveLength(active);
    expect(new Set(rows.map((r) => r.id)).size).toBe(active);
    // And every row lands in a bucket.
    expect(rows.every((r) => r.bucket.length > 0)).toBe(true);
  });

  it("is readable by the chef, who plans around what is short", async () => {
    const { ingredients } = seeded();
    const rows = await listStockHealth();
    expect(find(rows, ingredients.plentiful)).toBeDefined();
  });
});
