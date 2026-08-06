import { describe, expect, it } from "vitest";
import { CustomerInvoiceStatus } from "@prisma/client";
import {
  APPROVABLE_STATUSES,
  APPROVAL_CLEARED,
  ORDER_INVOICE_INITIAL,
  approveRefusal,
  issueRefusal,
  mayReachCustomer,
  prorateQuantity,
  settledStatus,
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

describe("an order-linked invoice is born unapproved", () => {
  // The trigger case: booked for 100, 120 turned up. The bill the delivery
  // raises must be a draft nobody has signed, or the extra 20 never make it
  // on before the customer has the document.
  it("starts as an unissued, unapproved draft", () => {
    expect(ORDER_INVOICE_INITIAL.status).toBe(CustomerInvoiceStatus.DRAFT);
    expect(ORDER_INVOICE_INITIAL.approvedAt).toBeNull();
    expect(ORDER_INVOICE_INITIAL.issuedAt).toBeNull();
  });

  it("cannot be issued the moment it is created", () => {
    const refusal = issueRefusal({
      invoiceNo: "INV-26-27-0042",
      status: ORDER_INVOICE_INITIAL.status,
      onHold: false,
      onHoldReason: null,
      approvedAt: ORDER_INVOICE_INITIAL.approvedAt,
    });
    expect(refusal).toContain("hasn't been approved");
  });

  it("is the manager's to sign off, and nothing else is", () => {
    expect(
      approveRefusal({
        invoiceNo: "INV-26-27-0042",
        status: ORDER_INVOICE_INITIAL.status,
        approvedAt: ORDER_INVOICE_INITIAL.approvedAt,
      }),
    ).toBeNull();
  });
});

describe("may this invoice be emailed or viewed by the customer", () => {
  it("is false for the draft an order raises", () => {
    expect(mayReachCustomer(ORDER_INVOICE_INITIAL.status)).toBe(false);
  });

  it("is false for exactly DRAFT and true for every issued state", () => {
    // Exhaustive: a new CustomerInvoiceStatus must not quietly become
    // customer-facing without passing through the issue gate.
    const hidden = ALL_STATUSES.filter((status) => !mayReachCustomer(status));
    expect(hidden).toEqual([CustomerInvoiceStatus.DRAFT]);
  });

  it("opens only once the approved draft has been issued", () => {
    // The whole journey in one line: created → approved → issued → visible.
    expect(mayReachCustomer(CustomerInvoiceStatus.DRAFT)).toBe(false);
    expect(mayReachCustomer(CustomerInvoiceStatus.ISSUED)).toBe(true);
  });
});

describe("where an invoice lands when it is issued", () => {
  // Cash the driver took at the door is credited onto the draft, so the
  // status has to be settled from the money at issue — not assumed ISSUED.
  it("is ISSUED when nothing was collected", () => {
    expect(settledStatus("0", "11800.00")).toBe(CustomerInvoiceStatus.ISSUED);
  });

  it("is PAID when the door money covers the bill", () => {
    expect(settledStatus("11800.00", "11800.00")).toBe(CustomerInvoiceStatus.PAID);
    // Overpayment still settles rather than sitting part-paid forever.
    expect(settledStatus("12000.00", "11800.00")).toBe(CustomerInvoiceStatus.PAID);
  });

  it("is PARTIAL when it only covers some of it", () => {
    expect(settledStatus("5000.00", "11800.00")).toBe(CustomerInvoiceStatus.PARTIAL);
  });

  it("re-prices with the bill: 100 pax paid, 120 pax billed", () => {
    // The manager adds the extra 20 before releasing, and money that was
    // exactly enough becomes a part payment.
    expect(settledStatus("11800.00", "11800.00")).toBe(CustomerInvoiceStatus.PAID);
    expect(settledStatus("11800.00", "14160.00")).toBe(CustomerInvoiceStatus.PARTIAL);
  });

  it("uses Decimal, not floats", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in float arithmetic, which would
    // read as an overpayment against a 0.3 bill either way — the point is
    // that 0.3 vs 0.3 must settle exactly, never "0.29999… < 0.3".
    expect(settledStatus("0.3", "0.30")).toBe(CustomerInvoiceStatus.PAID);
    expect(settledStatus("0.29", "0.30")).toBe(CustomerInvoiceStatus.PARTIAL);
  });

  it("treats a blank amount as nothing collected instead of crashing", () => {
    // decimalString permits "" — new Decimal("") throws.
    expect(settledStatus("", "11800.00")).toBe(CustomerInvoiceStatus.ISSUED);
    expect(settledStatus("0.00", "")).toBe(CustomerInvoiceStatus.ISSUED);
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
