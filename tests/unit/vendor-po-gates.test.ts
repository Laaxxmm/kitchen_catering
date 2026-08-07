import { describe, expect, it } from "vitest";
import { VendorBillStatus, VendorPOStatus } from "@prisma/client";
import { billProgress, closeRefusal, CLOSEABLE_PO_STATUSES } from "@/lib/vendor-po-gates";

// Closing a PO retires a live commitment to a supplier, so these are
// asserted exhaustively — a new VendorPOStatus must not quietly become
// closeable, and no unsettled bill must ever slip through.

const ALL_PO_STATUSES = Object.values(VendorPOStatus);
const ALL_BILL_STATUSES = Object.values(VendorBillStatus);

const paid = { billNo: "VB-26-27-0144", status: VendorBillStatus.PAID };

function close(over: Partial<Parameters<typeof closeRefusal>[0]> = {}) {
  return closeRefusal({
    poNo: "VPO-26-27-0305",
    status: VendorPOStatus.RECEIVED,
    anythingReceived: true,
    bills: [paid],
    ...over,
  });
}

describe("closeable statuses", () => {
  it("is exactly PARTIALLY_RECEIVED and RECEIVED", () => {
    expect(CLOSEABLE_PO_STATUSES).toEqual([
      VendorPOStatus.PARTIALLY_RECEIVED,
      VendorPOStatus.RECEIVED,
    ]);
  });

  it("refuses every other status, and points at cancel instead", () => {
    const allowed = ALL_PO_STATUSES.filter((status) => close({ status }) === null);
    expect(allowed).toEqual(CLOSEABLE_PO_STATUSES);
    // The stale-tab case: the button is hidden, the request still arrives.
    expect(close({ status: VendorPOStatus.SENT })).toContain("cancel it instead");
  });

  it("names the terminal states rather than telling you to cancel", () => {
    expect(close({ status: VendorPOStatus.CLOSED })).toContain("already closed");
    expect(close({ status: VendorPOStatus.CANCELLED })).toContain("cancelled");
  });
});

describe("money still owed blocks the close", () => {
  it("refuses when goods came in and no bill was ever recorded", () => {
    const refusal = close({ bills: [] });
    expect(refusal).toContain("no supplier bill has been recorded");
    expect(refusal).toContain("VPO-26-27-0305");
  });

  it("allows a PO nothing was received against and nothing billed", () => {
    // Nothing arrived, so nothing is owed — no liability to bury.
    expect(close({ anythingReceived: false, bills: [] })).toBeNull();
  });

  it("refuses on every unpaid bill status, naming the bill", () => {
    for (const status of ALL_BILL_STATUSES.filter((s) => s !== VendorBillStatus.PAID)) {
      const refusal = close({ bills: [{ billNo: "VB-26-27-0144", status }] });
      expect(refusal).toContain("VB-26-27-0144");
      expect(refusal).toContain("before closing");
    }
  });

  it("counts the other unpaid bills instead of naming only the first", () => {
    const refusal = close({
      bills: [
        paid,
        { billNo: "VB-2", status: VendorBillStatus.DISCREPANCY },
        { billNo: "VB-3", status: VendorBillStatus.APPROVED },
      ],
    });
    expect(refusal).toContain("VB-2");
    expect(refusal).toContain("and 1 more");
  });

  it("allows a fully received, fully paid PO", () => {
    expect(close()).toBeNull();
    expect(close({ status: VendorPOStatus.PARTIALLY_RECEIVED })).toBeNull();
  });
});

describe("bill progress on the PO banner", () => {
  it("is null when no bill exists, so the page prompts for one", () => {
    expect(billProgress([])).toBeNull();
  });

  it("reports where a single bill got to, and links to it", () => {
    for (const status of ALL_BILL_STATUSES) {
      const p = billProgress([{ id: "b1", billNo: "VB-1", status }]);
      expect(p?.headline).toContain("VB-1");
      expect(p?.billId).toBe("b1");
      expect(p?.next).toBeTruthy();
    }
  });

  it("flags a failed match loudly, and nothing else", () => {
    const attention = ALL_BILL_STATUSES.filter(
      (status) => billProgress([{ id: "b1", billNo: "VB-1", status }])?.attention,
    );
    expect(attention).toEqual([VendorBillStatus.DISCREPANCY]);
  });

  it("does not say 'awaiting a bill' once one is paid", () => {
    expect(billProgress([{ id: "b1", billNo: "VB-1", status: VendorBillStatus.PAID }])?.headline)
      .toBe("VB-1 is paid");
  });

  it("summarises several bills by stage instead of showing only the first", () => {
    const p = billProgress([
      { id: "b1", billNo: "VB-1", status: VendorBillStatus.PAID },
      { id: "b2", billNo: "VB-2", status: VendorBillStatus.DISCREPANCY },
      { id: "b3", billNo: "VB-3", status: VendorBillStatus.DRAFT },
      { id: "b4", billNo: "VB-4", status: VendorBillStatus.PENDING_MATCH },
    ]);
    expect(p?.headline).toContain("4 supplier bills recorded");
    expect(p?.headline).toContain("1 paid");
    expect(p?.headline).toContain("1 in discrepancy");
    // DRAFT and PENDING_MATCH are the same stage to a human — collapsed.
    expect(p?.headline).toContain("2 awaiting the 3-way match");
    expect(p?.attention).toBe(true);
    // Several bills: no single one to deep-link to, the page lists them all.
    expect(p?.billId).toBeNull();
    expect(p?.next).toBeNull();
  });
});
