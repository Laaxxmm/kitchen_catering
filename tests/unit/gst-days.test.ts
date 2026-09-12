import { describe, expect, it } from "vitest";
import { computeLine, summarise } from "@/lib/gst";

/**
 * The client's bill reads "No of Pax × Rate × No Of Days". A daily canteen
 * contract is one line per day, or one line for the month with days = 22;
 * either way the taxable value must be pax × rate × days.
 */
describe("No Of Days on an invoice line", () => {
  it("multiplies pax × rate × days; absent or blank days is 1", () => {
    const line = { quantity: 25, unitPrice: 125, discountPct: 0, gstRatePct: 5 };
    expect(computeLine({ ...line, days: 22 }).subtotal.toString()).toBe("68750");
    expect(computeLine(line).subtotal.toString()).toBe("3125");
    expect(computeLine({ ...line, days: "" }).subtotal.toString()).toBe("3125");
    expect(computeLine({ ...line, days: null }).subtotal.toString()).toBe("3125");
  });

  it("the Orbit AID August bill: 24 dated lines plus transport, 5% split CGST/SGST", () => {
    const pax = [25, 15, 15, 15, 18, 25, 22, 5, 17, 22, 20, 20, 25, 5, 17, 25, 20, 25, 22, 5, 22, 22, 20, 22];
    const rate = (i: number) => (i === 8 || i === 14 ? 200 : 125); // the two non-veg days
    const lines = pax.map((p, i) => ({ quantity: p, unitPrice: rate(i), discountPct: 0, gstRatePct: 5, days: 1 }));
    lines.push({ quantity: 1, unitPrice: 2000, discountPct: 0, gstRatePct: 5, days: 1 });
    const s = summarise({ lines, supplierStateCode: "29", placeOfSupplyStateCode: "29" });
    expect(s.subtotal.toString()).toBe("60675");
    expect(s.taxTotal.toString()).toBe("3033.75");
    expect(s.cgst.plus(s.sgst).toString()).toBe("3033.75");
    expect(s.igst.toString()).toBe("0");
    expect(s.grandTotal.toString()).toBe("63708.75");
  });
});
