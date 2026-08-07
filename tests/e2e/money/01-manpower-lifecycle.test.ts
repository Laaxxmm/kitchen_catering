import "./database";
import { beforeAll, describe, expect, it } from "vitest";
import { ManpowerRequestStatus, PaymentMethod } from "@prisma/client";
import { db } from "@/server/db";
import {
  approveManpowerRequest,
  cancelManpowerRequest,
  completeManpowerRequest,
  createManpowerRequest,
  getManpowerRequest,
  listManpowerRequests,
  payManpowerRequest,
  rejectManpowerRequest,
  settleManpowerCost,
} from "@/server/actions/manpower";
import { estimatedCost, requestedCost, wasEditedAtApproval } from "@/lib/manpower";
import {
  asAccounts,
  asAdmin,
  asChef,
  asDelivery,
  asManager,
  asStore,
  chefAccepts,
  desk,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  flushDeferred,
  mustOk,
  placeCateringOrder,
  read,
} from "../harness";

/**
 * Manpower, end to end: the chef hires casual labour in for a wedding, the
 * manager approves fewer people at a lower rate, the job gets done, accounts
 * settle what the labour actually invoiced, and the money goes out.
 *
 * Three things are worth more than the happy path:
 *   1. Both sets of figures survive. "Asked for 6 at ₹500, approved 4 at
 *      ₹450" is the whole reason the client wanted this screen.
 *   2. No rupee moves before approval AND completion AND a settled figure.
 *      Every one of those three gates is probed on its own.
 *   3. The order never moves. The client was explicit that manpower runs
 *      alongside an order and must never pause it.
 */

const ASKED = { people: 6, days: 2, rate: "500" }; // ₹6,000
const APPROVED = { people: 4, days: 2, rate: "450" }; // ₹3,600
const ACTUAL = "3900.00"; // the labour invoiced more than approved

let orderId: string;
let orderStatusBefore: string;
/** The order row as it stood before manpower touched anything. */
let orderRowBefore: { contractValue: string; updatedAt: number };
let requestId: string;

/** Raise one as the chef, tagged to `orderId` unless told otherwise. */
async function raise(
  overrides: Partial<{
    orderId: string | null;
    workDescription: string;
    people: number;
    days: number;
    ratePerPersonPerDay: string;
  }> = {},
): Promise<string> {
  asChef();
  const created = mustOk(
    await createManpowerRequest({
      orderId: overrides.orderId === undefined ? orderId : overrides.orderId,
      workDescription: overrides.workDescription ?? "Serving crew for the banquet",
      people: overrides.people ?? ASKED.people,
      days: overrides.days ?? ASKED.days,
      ratePerPersonPerDay: overrides.ratePerPersonPerDay ?? ASKED.rate,
    }),
    "raise manpower request",
  );
  return created.id;
}

beforeAll(async () => {
  await ensureSeeded();
  const order = await placeCateringOrder();
  orderId = order.id;
  await chefAccepts(orderId);
  // The reference point for "the order never moves". Captured after the last
  // thing that is ALLOWED to move it, so any later change is manpower's.
  const before = await read.order(orderId);
  orderStatusBefore = before.status;
  orderRowBefore = {
    contractValue: before.contractValue.toString(),
    updatedAt: before.updatedAt.getTime(),
  };
});

describe("raising one", () => {
  it("refuses a blank rate rather than crashing on new Decimal('')", async () => {
    asChef();
    const message = await expectRefused(() =>
      createManpowerRequest({
        orderId,
        workDescription: "Serving crew for the banquet",
        people: 6,
        days: 2,
        ratePerPersonPerDay: "",
      }),
    );
    expect(message).toContain("Enter an amount");
  });

  it("refuses a rate of zero — labour is never free", async () => {
    asChef();
    await expectRefused(() =>
      createManpowerRequest({
        orderId,
        workDescription: "Serving crew for the banquet",
        people: 6,
        days: 2,
        ratePerPersonPerDay: "0",
      }),
    );
  });

  it("refuses an order that does not exist", async () => {
    asChef();
    const message = await expectRefused(() =>
      createManpowerRequest({
        orderId: "no-such-order",
        workDescription: "Serving crew",
        people: 1,
        days: 1,
        ratePerPersonPerDay: "100",
      }),
    );
    expect(message).toContain("Order not found");
  });

  it("is not the store keeper's to raise", async () => {
    asStore();
    await expectRefused(() =>
      createManpowerRequest({
        orderId,
        workDescription: "Serving crew",
        people: 1,
        days: 1,
        ratePerPersonPerDay: "100",
      }),
    );
  });

  it("takes the chef's ask, tagged to the order", async () => {
    requestId = await raise();
    const row = await db.manpowerRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.status).toBe(ManpowerRequestStatus.REQUESTED);
    expect(row.orderId).toBe(orderId);
    expect(row.requestedPeople).toBe(ASKED.people);
    expect(row.requestedDays).toBe(ASKED.days);
    expectDecimal(row.requestedRate, ASKED.rate, "requested rate");
    // Nothing is approved yet, so there is nothing to pay against.
    expect(row.approvedPeople).toBeNull();
    expect(row.approvedRate).toBeNull();
    expect(row.actualCost).toBeNull();
    expect(await read.auditActions("ManpowerRequest", requestId)).toEqual([
      "MANPOWER_REQUESTED",
    ]);
  });
});

describe("no money before approval", () => {
  it("refuses to settle a cost on a request nobody has approved", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      settleManpowerCost({ id: requestId, actualCost: ACTUAL }),
    );
    expect(message).toContain("mark the job done before settling");
  });

  it("refuses to pay it", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      payManpowerRequest({ id: requestId, method: PaymentMethod.UPI }),
    );
    expect(message).toContain("Nobody has approved");
  });

  it("refuses to mark the job done before it was approved", async () => {
    asChef();
    const message = await expectRefused(() => completeManpowerRequest(requestId));
    expect(message).toContain("can't be marked completed");
  });

  it("left nothing on the row", async () => {
    const row = await db.manpowerRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.status).toBe(ManpowerRequestStatus.REQUESTED);
    expect(row.actualCost).toBeNull();
    expect(row.paidAt).toBeNull();
  });
});

describe("approval is management's, and it may change the numbers", () => {
  it("is not accounts' signature to give", async () => {
    asAccounts();
    await expectRefused(() =>
      approveManpowerRequest({ id: requestId, people: 4, days: 2, ratePerPersonPerDay: "450" }),
    );
  });

  it("is not the chef's own to give", async () => {
    // The chef raised it; approving it is a separate desk by role, so a
    // requester cannot wave their own request through.
    asChef();
    await expectRefused(() => approveManpowerRequest({ id: requestId }));
    asChef();
    await expectRefused(() => rejectManpowerRequest(requestId, "changed my mind"));
  });

  it("refuses a blank approved rate", async () => {
    asManager();
    const message = await expectRefused(() =>
      approveManpowerRequest({ id: requestId, ratePerPersonPerDay: "" }),
    );
    expect(message).toContain("Enter an amount");
  });

  it("approves 4 at ₹450 against an ask of 6 at ₹500", async () => {
    asManager();
    mustOk(
      await approveManpowerRequest({
        id: requestId,
        people: APPROVED.people,
        days: APPROVED.days,
        ratePerPersonPerDay: APPROVED.rate,
        note: "Four is enough — the in-house crew covers the rest.",
      }),
      "approve manpower",
    );
    const row = await db.manpowerRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.status).toBe(ManpowerRequestStatus.APPROVED);
    expect(row.approvedById).not.toBeNull();
    expect(row.approvalNote).toContain("Four is enough");
  });

  it("kept BOTH sets of figures — the ask and the grant", async () => {
    const row = await db.manpowerRequest.findUniqueOrThrow({ where: { id: requestId } });
    // What was asked for, untouched.
    expect(row.requestedPeople).toBe(6);
    expect(row.requestedDays).toBe(2);
    expectDecimal(row.requestedRate, "500", "requested rate after approval");
    // What was granted.
    expect(row.approvedPeople).toBe(4);
    expect(row.approvedDays).toBe(2);
    expectDecimal(row.approvedRate, "450", "approved rate");
    // And the two costs the report prints side by side.
    expectDecimal(requestedCost(row), "6000", "cost as asked");
    expectDecimal(estimatedCost(row), "3600", "cost as approved");
    expect(wasEditedAtApproval(row)).toBe(true);
  });

  it("cannot be approved twice", async () => {
    asManager();
    const message = await expectRefused(() => approveManpowerRequest({ id: requestId }));
    expect(message).toContain("already approved");
  });
});

describe("no money before the job is done", () => {
  it("refuses to settle a cost on an approved-but-unworked request", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      settleManpowerCost({ id: requestId, actualCost: ACTUAL }),
    );
    expect(message).toContain("mark the job done before settling");
  });

  it("refuses to pay the estimate", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      payManpowerRequest({ id: requestId, method: PaymentMethod.UPI }),
    );
    expect(message).toContain("isn't marked done yet");
  });

  it("is not accounts' place to mark the job done", async () => {
    asAccounts();
    await expectRefused(() => completeManpowerRequest(requestId));
  });

  it("the chef marks it done", async () => {
    asChef();
    mustOk(await completeManpowerRequest(requestId), "complete manpower");
    const row = await db.manpowerRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.status).toBe(ManpowerRequestStatus.COMPLETED);
    expect(row.completedAt).not.toBeNull();
    expect(row.completedById).not.toBeNull();
  });
});

describe("no money before a figure is settled", () => {
  it("refuses to pay a completed request nobody has costed", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      payManpowerRequest({ id: requestId, method: PaymentMethod.UPI }),
    );
    expect(message).toContain("Record the actual cost");
  });

  it("refuses a blank settled cost rather than crashing on new Decimal('')", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      settleManpowerCost({ id: requestId, actualCost: "" }),
    );
    expect(message).toContain("Enter an amount");
    expect(
      (await db.manpowerRequest.findUniqueOrThrow({ where: { id: requestId } })).actualCost,
    ).toBeNull();
  });

  it("refuses a negative settled cost", async () => {
    asAccounts();
    await expectRefused(() => settleManpowerCost({ id: requestId, actualCost: "-100" }));
  });

  it("is not the chef's cost to settle", async () => {
    asChef();
    await expectRefused(() => settleManpowerCost({ id: requestId, actualCost: ACTUAL }));
  });

  it("accounts settle the ACTUAL cost, above the approved estimate", async () => {
    asAccounts();
    mustOk(
      await settleManpowerCost({
        id: requestId,
        actualCost: ACTUAL,
        note: "Labour invoiced two extra hours.",
      }),
      "settle actual cost",
    );
    const row = await db.manpowerRequest.findUniqueOrThrow({ where: { id: requestId } });
    // Settling is not a status move — it stays COMPLETED until it is paid.
    expect(row.status).toBe(ManpowerRequestStatus.COMPLETED);
    expectDecimal(row.actualCost, ACTUAL, "settled actual cost");
    expect(row.settledAt).not.toBeNull();
    // The estimate is untouched by the settlement, so the variance is real.
    expectDecimal(estimatedCost(row), "3600", "estimate after settling");
  });

  it("a completed request cannot be cancelled — the labour has worked", async () => {
    for (const become of [asChef, asManager, asAdmin]) {
      become();
      const message = await expectRefused(() => cancelManpowerRequest(requestId));
      expect(message).toContain("can't be marked cancelled");
    }
    expect(
      (await db.manpowerRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
    ).toBe(ManpowerRequestStatus.COMPLETED);
  });
});

describe("paid", () => {
  it("is not the chef's money to pay out", async () => {
    asChef();
    await expectRefused(() => payManpowerRequest({ id: requestId, method: PaymentMethod.UPI }));
  });

  it("refuses an unparseable payment date", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      payManpowerRequest({
        id: requestId,
        method: PaymentMethod.UPI,
        paidAt: "not-a-date",
      }),
    );
    expect(message).toContain("valid payment date");
  });

  it("accounts pay the settled figure", async () => {
    asAccounts();
    mustOk(
      await payManpowerRequest({
        id: requestId,
        method: PaymentMethod.UPI,
        reference: "E2E-MANPOWER-001",
      }),
      "pay manpower",
    );
    const row = await db.manpowerRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row.status).toBe(ManpowerRequestStatus.PAID);
    expect(row.paidAt).not.toBeNull();
    expect(row.paymentMethod).toBe(PaymentMethod.UPI);
    expect(row.paymentReference).toBe("E2E-MANPOWER-001");
    expectDecimal(row.actualCost, ACTUAL, "amount paid");
  });

  it("cannot be paid twice", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      payManpowerRequest({ id: requestId, method: PaymentMethod.CASH }),
    );
    expect(message).toContain("already paid");
  });

  it("freezes the settled figure once it has been paid", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      settleManpowerCost({ id: requestId, actualCost: "9999" }),
    );
    expect(message).toContain("already paid");
    expectDecimal(
      (await db.manpowerRequest.findUniqueOrThrow({ where: { id: requestId } })).actualCost,
      ACTUAL,
      "settled cost after a refused re-settle",
    );
  });

  it("recorded the whole trail", async () => {
    expect(await read.auditActions("ManpowerRequest", requestId)).toEqual([
      "MANPOWER_REQUESTED",
      "MANPOWER_APPROVED",
      "MANPOWER_COMPLETED",
      "MANPOWER_COST_SETTLED",
      "MANPOWER_PAID",
    ]);
  });
});

describe("the order was never touched", () => {
  it("is on exactly the status it was before any of this", async () => {
    expect(await read.orderStatus(orderId)).toBe(orderStatusBefore);
  });

  it("carries no manpower money, and was not so much as re-saved", async () => {
    // Manpower is a tag on the order, not a line of it — the order's own
    // contract value must be blind to ₹3,900 of hired labour, and `updatedAt`
    // catches even a no-op write the status check would sail past.
    const order = await read.order(orderId);
    expectDecimal(order.contractValue, orderRowBefore.contractValue, "contract value");
    expect(order.updatedAt.getTime()).toBe(orderRowBefore.updatedAt);
  });
});

describe("standalone requests — no order behind them", () => {
  let standaloneId: string;

  it("F&B raises one with no order at all", async () => {
    standaloneId = await raise({
      orderId: null,
      workDescription: "Deep clean of the banquet hall",
      people: 3,
      days: 1,
      ratePerPersonPerDay: "600",
    });
    const row = await db.manpowerRequest.findUniqueOrThrow({ where: { id: standaloneId } });
    expect(row.orderId).toBeNull();
    expectDecimal(requestedCost(row), "1800", "standalone estimate");
  });

  it("approving it unchanged still stamps the approved figures", async () => {
    asManager();
    mustOk(await approveManpowerRequest({ id: standaloneId }), "approve as asked");
    const row = await db.manpowerRequest.findUniqueOrThrow({ where: { id: standaloneId } });
    expect(row.approvedPeople).toBe(3);
    expect(row.approvedDays).toBe(1);
    expectDecimal(row.approvedRate, "600", "approved rate mirrors the ask");
    expect(wasEditedAtApproval(row)).toBe(false);
    expectDecimal(estimatedCost(row), "1800", "estimate equals the ask");
  });

  it("runs the same money gates as an order-tagged one", async () => {
    asAccounts();
    expect(
      await expectRefused(() => payManpowerRequest({ id: standaloneId, method: PaymentMethod.CASH })),
    ).toContain("isn't marked done yet");

    asDelivery();
    mustOk(await completeManpowerRequest(standaloneId), "complete standalone");

    asAccounts();
    expect(
      await expectRefused(() => payManpowerRequest({ id: standaloneId, method: PaymentMethod.CASH })),
    ).toContain("Record the actual cost");

    mustOk(await settleManpowerCost({ id: standaloneId, actualCost: "1500" }), "settle below estimate");
    mustOk(
      await payManpowerRequest({ id: standaloneId, method: PaymentMethod.CASH }),
      "pay standalone",
    );
    const row = await db.manpowerRequest.findUniqueOrThrow({ where: { id: standaloneId } });
    expect(row.status).toBe(ManpowerRequestStatus.PAID);
    expectDecimal(row.actualCost, "1500", "standalone settled under estimate");
  });
});

describe("calling one off", () => {
  it("the chef may withdraw their own ask", async () => {
    const id = await raise({ workDescription: "Extra pot washers — raised in error" });
    asChef();
    mustOk(await cancelManpowerRequest(id), "chef cancels own request");
    expect(
      (await db.manpowerRequest.findUniqueOrThrow({ where: { id } })).status,
    ).toBe(ManpowerRequestStatus.CANCELLED);
  });

  it("is not accounts' to call off", async () => {
    const id = await raise({ workDescription: "Bar crew" });
    asAccounts();
    await expectRefused(() => cancelManpowerRequest(id));
    expect(
      (await db.manpowerRequest.findUniqueOrThrow({ where: { id } })).status,
    ).toBe(ManpowerRequestStatus.REQUESTED);
  });

  it("someone else's ask is not the delivery driver's to call off", async () => {
    const id = await raise({ workDescription: "Cloakroom cover" });
    asDelivery();
    const message = await expectRefused(() => cancelManpowerRequest(id));
    expect(message).toContain("Only the person who raised this request");
  });

  it("a rejected request is terminal", async () => {
    const id = await raise({ workDescription: "Second bar crew" });
    asManager();
    await expectRefused(() => rejectManpowerRequest(id, "   "));
    mustOk(await rejectManpowerRequest(id, "Budget is spent for this event."), "reject");
    const row = await db.manpowerRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe(ManpowerRequestStatus.REJECTED);
    expect(row.rejectionReason).toContain("Budget is spent");

    asManager();
    expect(await expectRefused(() => approveManpowerRequest({ id }))).toContain(
      "nothing more can be done",
    );
    asChef();
    await expectRefused(() => cancelManpowerRequest(id));
  });

  it("still never moved the order", async () => {
    expect(await read.orderStatus(orderId)).toBe(orderStatusBefore);
  });
});

describe("the desks get told", () => {
  it("puts a new ask in front of the people who can approve it, and nobody else", async () => {
    const id = await raise({ workDescription: "Notification probe — extra crew" });
    await flushDeferred();
    const notified = await db.notification.findMany({
      where: { link: `/manpower/${id}` },
      select: { userId: true, title: true, body: true },
    });
    expect(notified.length).toBeGreaterThan(0);
    expect(notified[0].title).toContain("awaiting approval");
    // ADMIN + MANAGER only — the estimate is management's decision to take.
    expect(new Set(notified.map((n) => n.userId))).toEqual(
      new Set([desk("admin").id, desk("manager").id]),
    );
    // The ask, not the grant — there is no grant yet.
    expect(notified[0].body).toContain("6 × 2 day(s)");

    asManager();
    mustOk(
      await approveManpowerRequest({ id, people: 2, days: 1, ratePerPersonPerDay: "300" }),
      "approve probe",
    );
    await flushDeferred();
    const back = await db.notification.findMany({
      where: { link: `/manpower/${id}`, title: "Manpower request approved" },
      select: { userId: true, body: true },
    });
    // The chef who raised it hears what was actually granted.
    expect(back.map((n) => n.userId)).toEqual([desk("chef").id]);
    expect(back[0].body).toContain("2 people × 1 day(s)");
  });
});

describe("who may look", () => {
  it("lets every desk that can open an order see the labour on it", async () => {
    for (const become of [asAdmin, asManager, asChef, asStore, asAccounts, asDelivery]) {
      become();
      const rows = await listManpowerRequests({ orderId });
      expect(Array.isArray(rows)).toBe(true);
    }
  });

  it("scopes the chef's own view to their own asks", async () => {
    asChef();
    const mine = await listManpowerRequests({ mine: true, statuses: [] });
    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) {
      expect(row.requestedBy.id).toBe(mine[0].requestedBy.id);
    }
  });

  it("shows the ask and the grant side by side on the detail read", async () => {
    asManager();
    const row = await getManpowerRequest(requestId);
    expect(row).not.toBeNull();
    expect(row!.requestedPeople).toBe(6);
    expect(row!.approvedPeople).toBe(4);
    expectDecimal(row!.requestedRate, "500", "requested rate on the detail read");
    expectDecimal(row!.approvedRate, "450", "approved rate on the detail read");
  });
});
