import { describe, expect, it } from "vitest";
import { normaliseUnit, unitsEquivalent } from "@/lib/units";

// This comparison decides whether received goods reach stock. Too strict and
// a spelling difference silently loses inventory (what happened with
// "pcts" vs "pct"); too loose and packets get posted as kilograms.
describe("unitsEquivalent", () => {
  it("treats spelling variants of the same measure as equal", () => {
    for (const [a, b] of [
      ["pcts", "pct"],
      ["Pkt ", "packets"],
      ["Kgs", "kg"],
      ["Nos", "nos"],
      ["nos", "pieces"],
      ["Ltr", "litre"],
      ["gms", "gram"],
      ["Trays", "tray"],
    ]) {
      expect(unitsEquivalent(a, b), `${a} ≠ ${b}`).toBe(true);
    }
  });

  it("keeps genuinely different measures apart", () => {
    for (const [a, b] of [
      ["pkt", "kg"],
      ["pct", "pcs"], // a packet is not a piece — needs a human conversion
      ["kg", "g"], // same family, different magnitude — must not auto-post
      ["l", "ml"],
      ["tray", "pcs"],
    ]) {
      expect(unitsEquivalent(a, b), `${a} should differ from ${b}`).toBe(false);
    }
  });

  it("normalises punctuation and case", () => {
    expect(normaliseUnit(" K.G. ")).toBe("kg");
    expect(normaliseUnit("P C S")).toBe("pcs");
  });

  it("passes unknown units through unchanged rather than guessing", () => {
    expect(normaliseUnit("bunch")).toBe("bunch");
    expect(unitsEquivalent("bunch", "bunch")).toBe(true);
    expect(unitsEquivalent("bunch", "kg")).toBe(false);
  });
});
