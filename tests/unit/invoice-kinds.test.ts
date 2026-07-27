import { describe, expect, it } from "vitest";
import { CustomerInvoiceKind } from "@prisma/client";
import { EXCLUDE_PROFORMA } from "@/lib/invoice-kinds";

// A proforma carries the full order value at status ISSUED. Every money sum
// (revenue, AR, GST) must filter it out or it double-counts the order. This
// pins the single source of truth so the exclusion can't silently drift.
describe("EXCLUDE_PROFORMA", () => {
  it("excludes exactly the PROFORMA kind", () => {
    expect(EXCLUDE_PROFORMA).toEqual({ kind: { not: CustomerInvoiceKind.PROFORMA } });
  });
});
