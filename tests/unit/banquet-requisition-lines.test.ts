import { describe, expect, it } from "vitest";
import {
  backLinkBanquetPOLines,
  planBanquetProcurementLines,
  type BanquetProcurementSource,
} from "@/lib/validators";

// The batch "raise 1 PO for these items" path. Everything money- or
// link-shaped here is deterministic and DB-free, so it's tested directly:
// a wrong shortfall buys the wrong quantity, and a wrong PO-line back-link
// silently breaks the GRN flip-back (the line never becomes issuable again).

function source(over: Partial<BanquetProcurementSource> = {}): BanquetProcurementSource {
  return {
    requisitionLineId: "rl-1",
    itemId: "item-1",
    sku: "CUP-01",
    name: "Paper cups",
    unit: "pcs",
    requestedQty: "10",
    issuedQty: "0",
    ...over,
  };
}

describe("planBanquetProcurementLines", () => {
  it("buys the shortfall, not the requested qty — decimals intact", () => {
    const [line] = planBanquetProcurementLines([
      source({ requestedQty: "2.5", issuedQty: "0.75" }),
    ]);
    expect(line.quantity).toBe("1.75");
  });

  it("keeps precision floats would lose", () => {
    const [line] = planBanquetProcurementLines([source({ requestedQty: "0.3", issuedQty: "0.1" })]);
    expect(line.quantity).toBe("0.2"); // 0.3 - 0.1 = 0.19999999999999998 in float
  });

  it("rejects a line with nothing left to buy", () => {
    expect(() =>
      planBanquetProcurementLines([source({ requestedQty: "5", issuedQty: "5" })]),
    ).toThrow(/nothing still short/);
    // Over-issued (negative shortfall) is just as much a non-purchase.
    expect(() =>
      planBanquetProcurementLines([source({ requestedQty: "5", issuedQty: "7" })]),
    ).toThrow(/nothing still short/);
  });

  it("defaults a blank or missing price to 0 rather than crashing the money math", () => {
    const [blank] = planBanquetProcurementLines([source({ unitPrice: "  " })]);
    const [missing] = planBanquetProcurementLines([source({ unitPrice: undefined })]);
    expect(blank.unitPrice).toBe("0");
    expect(missing.unitPrice).toBe("0");
    const [priced] = planBanquetProcurementLines([source({ unitPrice: "12.50" })]);
    expect(priced.unitPrice).toBe("12.50");
  });

  it("maps N picked lines to N PO lines, in order, each on its own item", () => {
    const plan = planBanquetProcurementLines([
      source({ requisitionLineId: "rl-1", itemId: "item-1", name: "Paper cups" }),
      source({ requisitionLineId: "rl-2", itemId: "item-2", name: "Trays", sku: null }),
      source({
        requisitionLineId: "rl-3",
        itemId: "item-3",
        name: "Foil",
        requestedQty: "4",
        issuedQty: "1",
      }),
    ]);
    expect(plan).toHaveLength(3);
    expect(plan.map((l) => l.banquetItemId)).toEqual(["item-1", "item-2", "item-3"]);
    expect(plan.map((l) => l.quantity)).toEqual(["10", "10", "3"]);
    expect(plan[1].sku).toBe(""); // a null SKU must not reach the PO as "null"
  });
});

describe("backLinkBanquetPOLines", () => {
  const plan = planBanquetProcurementLines([
    source({ requisitionLineId: "rl-1", itemId: "item-1" }),
    source({ requisitionLineId: "rl-2", itemId: "item-2" }),
  ]);

  it("links each requisition line to the PO line for its own item", () => {
    expect(
      backLinkBanquetPOLines(plan, [
        { id: "pol-a", banquetItemId: "item-1" },
        { id: "pol-b", banquetItemId: "item-2" },
      ]),
    ).toEqual([
      { requisitionLineId: "rl-1", poLineId: "pol-a" },
      { requisitionLineId: "rl-2", poLineId: "pol-b" },
    ]);
  });

  it("refuses to link when the PO lines come back for the wrong items", () => {
    expect(() =>
      backLinkBanquetPOLines(plan, [
        { id: "pol-a", banquetItemId: "item-2" },
        { id: "pol-b", banquetItemId: "item-1" },
      ]),
    ).toThrow(/wrong item/);
  });

  it("refuses to link a mismatched number of lines", () => {
    expect(() => backLinkBanquetPOLines(plan, [{ id: "pol-a", banquetItemId: "item-1" }])).toThrow(
      /different number of lines/,
    );
  });
});
