import { describe, expect, it } from "vitest";
import { BanquetRequisitionLineStatus } from "@prisma/client";
import { planBanquetLineAmend } from "@/app/(dashboard)/banquet/requisitions/[id]/_components/amend-qty";

// "He already has given five. So, additionally, he has required five." —
// raising the ask on a line the store already issued against is the whole
// feature, and the resulting status is what puts the shortfall back in the
// store's queue. Get it wrong and either the extra never gets issued (line
// stuck at ISSUED) or stock that's already out looks un-issued.

function plan(
  requestedQty: string,
  issuedQty: string,
  newQty: string,
  lineStatus: BanquetRequisitionLineStatus = BanquetRequisitionLineStatus.PENDING,
) {
  return planBanquetLineAmend({
    requestedQty,
    issuedQty,
    newQty,
    unit: "pcs",
    lineStatus,
  });
}

describe("planBanquetLineAmend", () => {
  it("raising a fully-issued line reopens it as PARTIALLY_ISSUED", () => {
    const res = plan("5", "5", "10");
    expect(res).toEqual({
      ok: true,
      newQty: "10",
      status: BanquetRequisitionLineStatus.PARTIALLY_ISSUED,
    });
  });

  it("raising an untouched line leaves it PENDING", () => {
    expect(plan("5", "0", "10")).toEqual({
      ok: true,
      newQty: "10",
      status: BanquetRequisitionLineStatus.PENDING,
    });
  });

  it("lowering to exactly what's issued closes the line as ISSUED", () => {
    expect(plan("10", "4", "4")).toEqual({
      ok: true,
      newQty: "4",
      status: BanquetRequisitionLineStatus.ISSUED,
    });
  });

  it("rejects going below the issued qty and names the amount", () => {
    const res = plan("10", "5", "4");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("5 pcs already issued");
  });

  it("rejects a no-op change", () => {
    expect(plan("5", "0", "5").ok).toBe(false);
    // Decimal-equal, not string-equal — 5.000 is still no change.
    expect(plan("5", "0", "5.000").ok).toBe(false);
  });

  it("rejects zero, negative and garbage", () => {
    expect(plan("5", "0", "0").ok).toBe(false);
    expect(plan("5", "0", "-2").ok).toBe(false);
    expect(plan("5", "0", "").ok).toBe(false);
    expect(plan("5", "0", "abc").ok).toBe(false);
  });

  it("compares in decimals, not floats", () => {
    // 0.1 + 0.2 territory: a float compare would call 0.3 below 0.30000000000000004.
    expect(plan("0.5", "0.3", "0.3")).toEqual({
      ok: true,
      newQty: "0.3",
      status: BanquetRequisitionLineStatus.ISSUED,
    });
    // Decimal(14,3): the stored value is the rounded one, so a 4th place that
    // rounds back to the current qty is still a no-op.
    expect(plan("2.5", "1", "2.5004").ok).toBe(false);
    expect(plan("2.5", "1", "2.5006")).toEqual({
      ok: true,
      newQty: "2.501",
      status: BanquetRequisitionLineStatus.PARTIALLY_ISSUED,
    });
  });
});

// The two stores must decide identically — the client asked for F&B to work
// "as same as kitchen request line". These cases were added after the banquet
// and kitchen implementations were built independently and DID diverge on the
// PO case: one blocked the amend outright, the other allowed it. Pinning both.
describe("parity with the kitchen rule (decideAmend)", () => {
  const { AWAITING_PROCUREMENT, CANCELLED, PARTIALLY_ISSUED } = BanquetRequisitionLineStatus;

  it("keeps AWAITING_PROCUREMENT when a PO is already out", () => {
    // The number moves so the store knows the real need; the flag stays so GRN
    // acceptance still re-opens the line (it matches on exactly this status).
    // Clearing it here would drop the line out of that handshake and the goods
    // would land with nothing to receive them against.
    expect(plan("5", "0", "10", AWAITING_PROCUREMENT)).toEqual({
      ok: true,
      newQty: "10",
      status: AWAITING_PROCUREMENT,
    });
  });

  it("still refuses to go below what is already issued, PO or not", () => {
    expect(plan("10", "5", "3", AWAITING_PROCUREMENT).ok).toBe(false);
  });

  it("refuses a cancelled line", () => {
    expect(plan("5", "0", "10", CANCELLED)).toEqual({
      ok: false,
      error: "This item was cancelled — its quantity can't be changed.",
    });
  });

  it("drops a fully-issued line back to partially issued — the whole feature", () => {
    expect(plan("5", "5", "10", BanquetRequisitionLineStatus.ISSUED)).toEqual({
      ok: true,
      newQty: "10",
      status: PARTIALLY_ISSUED,
    });
  });
});
