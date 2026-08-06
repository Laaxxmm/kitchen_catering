import { describe, expect, it } from "vitest";
import { CustomerInvoiceStatus } from "@prisma/client";
import {
  APPROVABLE_STATUSES,
  APPROVAL_CLEARED,
  approveRefusal,
  issueRefusal,
  prorateQuantity,
} from "@/lib/customer-invoice-gates";

// A customer's GST invoice leaves the building on these decisions, so they
// are asserted exhaustively — a new CustomerInvoiceStatus must not quietly
// become issuable without a signature.

const ALL_STATUSES = Object.values(CustomerInvoiceStatus);
const APPROVED = new Date("2026-08-06T10:00:00Z");

describe("which invoices may be approved", () => {
  it("is exactly DRAFT", () => {
    expect(APPROVABLE_STATUSES).toEqual([CustomerInvoiceStatus.DRAFT]);
    const approvable = ALL_STATUSES.filter(
      (status) => approveRefusal({ invoiceNo: "INV-1", status, approvedAt: null }) === null,
    );
    expect(approvable).toEqual([CustomerInvoiceStatus.DRAFT]);
  });

  it("names the actual status in the refusal", () => {
    expect(approveRefusal({ invoiceNo: "INV-1", status: CustomerInvoiceStatus.ISSUED, approvedAt: null }))
      .toContain("issued");
  });

  it("refuses a second signature on an already-approved draft", () => {
    const refusal = approveRefusal({
      invoiceNo: "INV-26-27-0009",
      status: CustomerInvoiceStatus.DRAFT,
      approvedAt: APPROVED,
    });
    expect(refusal).toContain("already approved");
  });
});

describe("which invoices may be issued", () => {
  const base = {
    invoiceNo: "INV-26-27-0009",
    status: CustomerInvoiceStatus.DRAFT,
    onHold: false,
    onHoldReason: null,
    approvedAt: APPROVED,
  };

  it("issues an approved draft", () => {
    expect(issueRefusal(base)).toBeNull();
  });

  it("refuses a draft nobody signed off", () => {
    const refusal = issueRefusal({ ...base, approvedAt: null });
    expect(refusal).toContain("INV-26-27-0009");
    expect(refusal).toContain("approved");
  });

  it("keeps refusing a held invoice even once approved", () => {
    // Hold and approval are different things: a hold is someone actively
    // blocking this one bill, and no signature clears it.
    const refusal = issueRefusal({ ...base, onHold: true, onHoldReason: "wrong billing address" });
    expect(refusal).toContain("on hold");
    expect(refusal).toContain("wrong billing address");
  });

  it("reports the hold before the missing approval", () => {
    const refusal = issueRefusal({ ...base, onHold: true, onHoldReason: null, approvedAt: null });
    expect(refusal).toContain("on hold");
  });

  it("only ever issues out of DRAFT", () => {
    const issuable = ALL_STATUSES.filter((status) => issueRefusal({ ...base, status }) === null);
    expect(issuable).toEqual([CustomerInvoiceStatus.DRAFT]);
  });
});

describe("an edit revokes the approval", () => {
  it("clears approver, timestamp and note together", () => {
    expect(APPROVAL_CLEARED).toEqual({ approvedAt: null, approvedById: null, approvalNote: null });
  });

  it("makes a previously-issuable invoice unissuable again", () => {
    // The scenario the rule exists for: a manager signs off ₹50,000,
    // someone edits it to ₹80,000, and the old signature must not travel
    // with the new number.
    const approved = {
      invoiceNo: "INV-26-27-0009",
      status: CustomerInvoiceStatus.DRAFT,
      onHold: false,
      onHoldReason: null,
      approvedAt: APPROVED,
    };
    expect(issueRefusal(approved)).toBeNull();
    const afterEdit = { ...approved, ...APPROVAL_CLEARED };
    expect(issueRefusal(afterEdit)).toContain("hasn't been approved");
    // ...and it can be signed off again against the new numbers.
    expect(approveRefusal({ invoiceNo: approved.invoiceNo, status: afterEdit.status, approvedAt: afterEdit.approvedAt }))
      .toBeNull();
  });
});

describe("pro-rata for the pax who actually turned up", () => {
  it("scales 100 → 120", () => {
    expect(prorateQuantity("100", 100, 120)).toBe("120");
    // The package-priced case: one line of qty 1 for the whole contract.
    expect(prorateQuantity("1", 100, 120)).toBe("1.2");
  });

  it("scales down as well as up", () => {
    expect(prorateQuantity("120", 120, 100)).toBe("100");
  });

  it("rounds to the 3 decimals the quantity column stores", () => {
    // 7 × 120 / 100 = 8.4; a repeating case must not carry more places
    // than Decimal(12,3) can hold, or the database rounds it for us.
    expect(prorateQuantity("7", 100, 120)).toBe("8.4");
    expect(prorateQuantity("1", 3, 1)).toBe("0.333");
  });

  it("uses Decimal, not floats", () => {
    // 0.1 × 3 / 1 is 0.30000000000000004 in float arithmetic.
    expect(prorateQuantity("0.1", 1, 3)).toBe("0.3");
  });

  it("cannot divide by zero or by a missing headcount", () => {
    expect(prorateQuantity("100", 0, 120)).toBeNull();
    expect(prorateQuantity("100", null, 120)).toBeNull();
    expect(prorateQuantity("100", undefined, 120)).toBeNull();
  });

  it("refuses a zero, missing or blank target instead of zeroing the bill", () => {
    expect(prorateQuantity("100", 100, 0)).toBeNull();
    expect(prorateQuantity("100", 100, null)).toBeNull();
    // decimalString lets "" through elsewhere; a blank box is not zero here.
    expect(prorateQuantity("", 100, 120)).toBeNull();
  });
});
