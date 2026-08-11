import { describe, expect, it } from "vitest";
import { VendorBillStatus } from "@prisma/client";
import {
  approveRefusal,
  editRefusal,
  isPayable,
  overpayRefusal,
  payRefusal,
  PAYABLE_STATUSES,
} from "@/lib/vendor-bill-gates";

// Money leaves the building on these decisions, so they are asserted
// exhaustively — a new VendorBillStatus must not quietly become payable.

const ALL_STATUSES = Object.values(VendorBillStatus);

describe("payable statuses", () => {
  it("is exactly APPROVED and OVERDUE", () => {
    expect(PAYABLE_STATUSES).toEqual([VendorBillStatus.APPROVED, VendorBillStatus.OVERDUE]);
  });

  it("refuses every other status", () => {
    const payable = ALL_STATUSES.filter(isPayable);
    expect(payable).toEqual([VendorBillStatus.APPROVED, VendorBillStatus.OVERDUE]);
  });

  it("refuses a bill that only passed the 3-way match", () => {
    // The stale-tab case: the button is hidden, the request still arrives.
    const refusal = payRefusal("VB-26-27-0001", VendorBillStatus.MATCHED);
    expect(refusal).toContain("VB-26-27-0001");
    expect(refusal).toContain("approve");
  });

  it("refuses a bill that failed the 3-way match", () => {
    expect(payRefusal("VB-1", VendorBillStatus.DISCREPANCY)).toContain("failed the 3-way match");
  });

  it("names the actual status in the refusal", () => {
    expect(payRefusal("VB-1", VendorBillStatus.PENDING_MATCH)).toContain("pending match");
  });

  it("allows an approved bill, and an approved bill gone past due", () => {
    expect(payRefusal("VB-1", VendorBillStatus.APPROVED)).toBeNull();
    expect(payRefusal("VB-1", VendorBillStatus.OVERDUE)).toBeNull();
  });
});

describe("approval", () => {
  const base = {
    billNo: "VB-26-27-0007",
    status: VendorBillStatus.MATCHED,
    reason: null,
  };

  it("approves a clean match", () => {
    expect(approveRefusal(base)).toBeNull();
  });

  // The supplier's invoice used to be required here, and it stopped the
  // accounts desk dead: vendors hand the paperwork over days late or not at
  // all, so every bill sat unapprovable and therefore unpayable. The upload
  // is still prompted for on the bill page — it just isn't a gate.
  it("does not need the supplier's invoice attached", () => {
    expect(approveRefusal(base)).toBeNull();
    expect(
      approveRefusal({ ...base, status: VendorBillStatus.DISCREPANCY, reason: "short delivery" }),
    ).toBeNull();
  });

  it("refuses a mismatched bill with no written reason", () => {
    expect(approveRefusal({ ...base, status: VendorBillStatus.DISCREPANCY })).toContain("written reason");
  });

  it("treats a whitespace-only reason as no reason", () => {
    const refusal = approveRefusal({ ...base, status: VendorBillStatus.DISCREPANCY, reason: "   " });
    expect(refusal).toContain("written reason");
  });

  it("approves a mismatched bill once the reason is given", () => {
    const ok = approveRefusal({
      ...base,
      status: VendorBillStatus.DISCREPANCY,
      reason: "Supplier billed 20kg, GRN accepted 18kg — vendor issuing a credit note.",
    });
    expect(ok).toBeNull();
  });

  it("only ever approves out of MATCHED or DISCREPANCY", () => {
    const approvable = ALL_STATUSES.filter(
      (status) => approveRefusal({ ...base, status, reason: "because" }) === null,
    );
    expect(approvable).toEqual([VendorBillStatus.MATCHED, VendorBillStatus.DISCREPANCY]);
  });
});

describe("editing a mismatched bill", () => {
  it("demands a reason when the bill failed the match", () => {
    expect(editRefusal("VB-1", VendorBillStatus.DISCREPANCY, null)).toContain("say why");
    expect(editRefusal("VB-1", VendorBillStatus.DISCREPANCY, " ")).toContain("say why");
  });

  it("accepts the edit once a reason is given", () => {
    expect(editRefusal("VB-1", VendorBillStatus.DISCREPANCY, "Corrected 20kg → 18kg")).toBeNull();
  });

  it("asks for nothing on an ordinary draft edit", () => {
    expect(editRefusal("VB-1", VendorBillStatus.DRAFT, null)).toBeNull();
  });
});

describe("overpayment ceiling", () => {
  it("allows paying exactly the balance", () => {
    expect(overpayRefusal("1000.00", "1000.00", "0")).toBeNull();
  });

  it("refuses a single cent over the balance", () => {
    expect(overpayRefusal("1000.01", "1000.00", "0")).toContain("outstanding balance");
  });

  it("counts what has already been paid", () => {
    expect(overpayRefusal("400.00", "1000.00", "600.00")).toBeNull();
    expect(overpayRefusal("400.01", "1000.00", "600.00")).toContain("₹400.00");
  });

  it("refuses anything on a fully paid bill", () => {
    expect(overpayRefusal("0.01", "1000.00", "1000.00")).toContain("₹0.00");
  });

  it("rejects a blank amount instead of reading it as zero", () => {
    // decimalString lets "" through; a blank box must not reach the Decimal.
    expect(overpayRefusal("", "1000.00", "0")).toBe("Enter the amount being paid.");
  });
});
