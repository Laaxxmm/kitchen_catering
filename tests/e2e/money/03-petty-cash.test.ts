import "./database";
import { beforeAll, describe, expect, it } from "vitest";
import { PettyCashVoucherStatus } from "@prisma/client";
import { db } from "@/server/db";
import {
  createPettyCashFloat,
  createPettyCashVoucher,
  deletePettyCashVoucher,
  getPettyCashFloat,
  getPettyCashReport,
  listPettyCashFloats,
  reversePettyCashVoucher,
  topUpPettyCash,
  updatePettyCashVoucher,
} from "@/server/actions/petty-cash";
import { toDecimal } from "@/lib/money";
import {
  asAccounts,
  asAdmin,
  asChef,
  asDelivery,
  asManager,
  asNobody,
  asStore,
  desk,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  mustOk,
} from "../harness";

/**
 * The cash tin: a float, the vouchers paid out of it, and the top-ups that
 * refill it. Two things are asserted at every step —
 *
 *   the balance is exactly opening + top-ups − vouchers + reversals, to the
 *   paisa, after every movement; and
 *
 *   a voucher's cash is only ever restored ONCE. Reversing twice, or
 *   deleting a voucher whose cash a reversal already put back, would
 *   double-credit the tin out of thin air.
 *
 * NOTE on negative balances: the brief for this suite says the balance must
 * never go negative. The product deliberately allows it — commit 4bd461c,
 * "floats may now go negative (client-confirmed IOU flow)", with the guard
 * relaxed and a `top it up` warning put in its place. Re-imposing the block
 * would delete a signed-off feature, so the scenario below asserts the rule
 * the product actually has (overspend is allowed AND is warned about) and
 * the divergence is reported rather than "fixed".
 */

let floatId: string;
/** What the balance should read after every movement so far. */
let expected = toDecimal(0);

async function balance(): Promise<string> {
  const row = await db.pettyCashFloat.findUniqueOrThrow({
    where: { id: floatId },
    select: { currentBalance: true },
  });
  return row.currentBalance.toString();
}

/** Assert the stored balance is exactly what the movements add up to. */
async function expectBalance(value: string, what: string): Promise<void> {
  expected = toDecimal(value);
  expectDecimal(await balance(), value, what);
}

async function postVoucher(amount: string, reason: string) {
  asAccounts();
  return createPettyCashVoucher({
    floatId,
    amount,
    category: "SUPPLIES",
    paidTo: "Local market",
    reason,
  });
}

beforeAll(async () => {
  await ensureSeeded();
});

describe("opening the tin", () => {
  it("is not the kitchen's, the store's or the driver's to open", async () => {
    for (const become of [asChef, asStore, asDelivery]) {
      become();
      await expectRefused(() =>
        createPettyCashFloat({
          custodianId: desk("accounts").id,
          name: "Rogue float",
          openingBalance: "10000",
        }),
      );
    }
    asNobody();
    await expectRefused(() => listPettyCashFloats());
  });

  it("refuses a blank opening balance rather than booking a float with no number in it", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      createPettyCashFloat({
        custodianId: desk("accounts").id,
        name: "Blank float",
        openingBalance: "",
      }),
    );
    // Not "Something went wrong on the server" — that was a raw
    // PrismaClientValidationError escaping with a stack trace behind it.
    expect(message).toContain("opening balance");
    expect(message).not.toContain("Something went wrong");
    expect(await db.pettyCashFloat.count({ where: { name: "Blank float" } })).toBe(0);
  });

  it("opens with ₹10,000 in it", async () => {
    asAccounts();
    const created = mustOk(
      await createPettyCashFloat({
        custodianId: desk("accounts").id,
        name: "E2E Kitchen Float",
        openingBalance: "10000",
      }),
      "create float",
    );
    floatId = created.id;
    await expectBalance("10000", "opening balance");
    const row = await db.pettyCashFloat.findUniqueOrThrow({ where: { id: floatId } });
    expectDecimal(row.openingBalance, "10000", "opening balance column");
    expect(row.active).toBe(true);
  });
});

describe("paying out of it", () => {
  it("refuses a blank amount rather than crashing on new Decimal('')", async () => {
    const message = await expectRefused(() => postVoucher("", "blank box"));
    // decimal.js throws a PLAIN Error whose message begins "[DecimalError]";
    // actionFailure has to catch that BEFORE its plain-Error passthrough or
    // the custodian is shown "[DecimalError] Invalid argument: ".
    expect(message).not.toContain("DecimalError");
    expect(message).toContain("isn't a valid number");
    await expectBalance("10000", "balance after a refused blank voucher");
  });

  it("refuses zero and negative amounts", async () => {
    for (const amount of ["0", "-500"]) {
      const message = await expectRefused(() => postVoucher(amount, "bad amount"));
      expect(message).toContain("must be positive");
    }
    await expectBalance("10000", "balance after refused amounts");
  });

  it("refuses a float that does not exist", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      createPettyCashVoucher({
        floatId: "no-such-float",
        amount: "100",
        category: "SUPPLIES",
        paidTo: "Nobody",
        reason: "Nothing",
      }),
    );
    expect(message).toContain("Float not found");
  });

  it("is not the store keeper's to spend, even as custodian", async () => {
    // AUDIT_REPORT M3: field roles reached balances and vouchers by direct
    // action invocation. The gate is the role, not the custodian field.
    asStore();
    await expectRefused(() =>
      createPettyCashVoucher({
        floatId,
        amount: "100",
        category: "SUPPLIES",
        paidTo: "Local market",
        reason: "Store keeper's own spend",
      }),
    );
    await expectBalance("10000", "balance after a refused store voucher");
  });

  it("takes ₹2,500 out and leaves ₹7,500", async () => {
    const result = mustOk(await postVoucher("2500", "Vegetables"), "voucher 1");
    expect(result.voucherNo).toBeTruthy();
    expect(result.warning).toBeUndefined();
    await expectBalance("7500", "balance after ₹2,500 out");
  });

  it("takes ₹1,200.50 out to the paisa", async () => {
    mustOk(await postVoucher("1200.50", "Gas cylinder top-up"), "voucher 2");
    await expectBalance("6299.50", "balance after ₹1,200.50 out");
  });
});

describe("editing a voucher moves the tin by the difference, not the amount", () => {
  let voucherId: string;

  beforeAll(async () => {
    const v = await db.pettyCashVoucher.findFirstOrThrow({
      where: { floatId, reason: "Gas cylinder top-up" },
      select: { id: true },
    });
    voucherId = v.id;
  });

  it("raises ₹1,200.50 to ₹1,500 and takes only the extra ₹299.50", async () => {
    asAccounts();
    mustOk(
      await updatePettyCashVoucher(voucherId, {
        amount: "1500",
        category: "SUPPLIES",
        paidTo: "Local market",
        reason: "Gas cylinder top-up",
        paidAt: new Date().toISOString(),
      }),
      "raise voucher",
    );
    await expectBalance("6000", "balance after the voucher was raised");
  });

  it("refuses a blank amount on the edit too", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      updatePettyCashVoucher(voucherId, {
        amount: "",
        category: "SUPPLIES",
        paidTo: "Local market",
        reason: "Gas cylinder top-up",
        paidAt: new Date().toISOString(),
      }),
    );
    expect(message).not.toContain("DecimalError");
    await expectBalance("6000", "balance after a refused blank edit");
  });

  it("is not the kitchen's to rewrite", async () => {
    asChef();
    await expectRefused(() =>
      updatePettyCashVoucher(voucherId, {
        amount: "1",
        category: "SUPPLIES",
        paidTo: "Local market",
        reason: "Gas cylinder top-up",
        paidAt: new Date().toISOString(),
      }),
    );
    await expectBalance("6000", "balance after a refused chef edit");
  });
});

describe("a voucher's cash comes back exactly once", () => {
  let voucherId: string;

  beforeAll(async () => {
    const v = await db.pettyCashVoucher.findFirstOrThrow({
      where: { floatId, reason: "Vegetables" },
      select: { id: true },
    });
    voucherId = v.id;
  });

  it("needs a reason to reverse", async () => {
    asAccounts();
    const message = await expectRefused(() => reversePettyCashVoucher(voucherId, "   "));
    expect(message).toContain("Reason required");
  });

  it("is not the driver's to reverse", async () => {
    asDelivery();
    await expectRefused(() => reversePettyCashVoucher(voucherId, "Cancelled"));
    await expectBalance("6000", "balance after a refused reversal");
  });

  it("puts the ₹2,500 back", async () => {
    asAccounts();
    mustOk(await reversePettyCashVoucher(voucherId, "Supplier refunded it"), "reverse voucher");
    await expectBalance("8500", "balance after the reversal");
    const row = await db.pettyCashVoucher.findUniqueOrThrow({ where: { id: voucherId } });
    expect(row.status).toBe(PettyCashVoucherStatus.REVERSED);
    expect(row.reversedAt).not.toBeNull();
  });

  it("refuses to reverse it a second time", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      reversePettyCashVoucher(voucherId, "Reversing again for fun"),
    );
    expect(message).toContain("already reversed");
    await expectBalance("8500", "balance after a refused second reversal");
  });

  it("refuses to DELETE it afterwards — that would credit the tin twice", async () => {
    asAdmin();
    const message = await expectRefused(() =>
      deletePettyCashVoucher(voucherId, "Tidying up"),
    );
    expect(message).toContain("double-credit");
    await expectBalance("8500", "balance after a refused delete-after-reverse");
    // And the row is still there to be audited against.
    expect(await db.pettyCashVoucher.count({ where: { id: voucherId } })).toBe(1);
  });

  it("refuses to edit a reversed voucher", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      updatePettyCashVoucher(voucherId, {
        amount: "9999",
        category: "SUPPLIES",
        paidTo: "Local market",
        reason: "Vegetables",
        paidAt: new Date().toISOString(),
      }),
    );
    expect(message).toContain("reversed");
    await expectBalance("8500", "balance after a refused edit of a reversed voucher");
  });

  it("gives the cash back when an un-reversed voucher is deleted, and only then", async () => {
    mustOk(await postVoucher("300", "Typo — wrong tin"), "voucher to delete");
    await expectBalance("8200", "balance after the mistaken voucher");

    const { id } = await db.pettyCashVoucher.findFirstOrThrow({
      where: { reason: "Typo — wrong tin" },
      select: { id: true },
    });
    asAccounts();
    // A hard delete leaves the audit row as its only trace, so the reason
    // is mandatory.
    const message = await expectRefused(() => deletePettyCashVoucher(id, "   "));
    expect(message).toContain("Reason required");
    await expectBalance("8200", "balance after a refused reasonless delete");

    mustOk(await deletePettyCashVoucher(id, "Recorded against the wrong float"), "delete voucher");
    await expectBalance("8500", "balance after the deletion put the cash back");
    expect(await db.pettyCashVoucher.count({ where: { id } })).toBe(0);
  });
});

describe("topping it up", () => {
  it("refuses a blank amount rather than crashing on new Decimal('')", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      topUpPettyCash({ floatId, amount: "", source: "BANK" }),
    );
    expect(message).not.toContain("DecimalError");
    expect(message).toContain("isn't a valid number");
    await expectBalance("8500", "balance after a refused blank top-up");
  });

  it("refuses zero and negative top-ups", async () => {
    asAccounts();
    for (const amount of ["0", "-1000"]) {
      const message = await expectRefused(() =>
        topUpPettyCash({ floatId, amount, source: "BANK" }),
      );
      expect(message).toContain("must be positive");
    }
    await expectBalance("8500", "balance after refused top-ups");
  });

  it("is not the kitchen's to refill", async () => {
    asChef();
    await expectRefused(() => topUpPettyCash({ floatId, amount: "1000", source: "BANK" }));
    await expectBalance("8500", "balance after a refused chef top-up");
  });

  it("adds ₹5,000", async () => {
    asAccounts();
    mustOk(
      await topUpPettyCash({ floatId, amount: "5000", source: "BANK", reference: "NEFT-TOPUP-1" }),
      "top up",
    );
    await expectBalance("13500", "balance after the top-up");
  });

  it("flags a top-up over the ₹10,000 threshold in the audit trail", async () => {
    asManager();
    mustOk(
      await topUpPettyCash({ floatId, amount: "12000", source: "BANK", reference: "NEFT-TOPUP-2" }),
      "large top up",
    );
    await expectBalance("25500", "balance after the large top-up");
    const actions = (
      await db.auditLog.findMany({
        where: { entity: "PettyCashFloat", entityId: floatId },
        orderBy: { at: "asc" },
        select: { action: true },
      })
    ).map((r) => r.action);
    expect(actions).toContain("PETTY_CASH_TOP_UP");
    expect(actions).toContain("PETTY_CASH_TOP_UP_OVER_THRESHOLD");
  });
});

describe("spending past the balance", () => {
  /**
   * The product's rule, not the obvious one: an overspend is allowed (the
   * custodian is out of pocket and the business owes them), but it must come
   * back with a warning naming the shortfall so the tin gets refilled.
   */
  it("lets the tin go negative and says so", async () => {
    const result = mustOk(await postVoucher("30000", "Emergency crockery hire"), "overspend");
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain("top it up");
    await expectBalance("-4500", "balance after the overspend");
  });

  it("puts it back the moment it is topped up", async () => {
    asAccounts();
    mustOk(await topUpPettyCash({ floatId, amount: "6000", source: "CASH" }), "recovery top-up");
    await expectBalance("1500", "balance after the recovery top-up");
  });
});

describe("the tin reconciles", () => {
  it("balances to opening + top-ups − vouchers + reversals, to the paisa", async () => {
    const row = await db.pettyCashFloat.findUniqueOrThrow({
      where: { id: floatId },
      include: { vouchers: true, topUps: true },
    });
    let computed = toDecimal(row.openingBalance);
    for (const t of row.topUps) computed = computed.plus(toDecimal(t.amount));
    for (const v of row.vouchers) {
      computed = computed.minus(toDecimal(v.amount));
      if (v.status === PettyCashVoucherStatus.REVERSED) {
        computed = computed.plus(toDecimal(v.amount));
      }
    }
    expectDecimal(row.currentBalance, computed.toString(), "reconciled balance");
    expectDecimal(row.currentBalance, expected.toString(), "balance the movements predicted");
  });

  it("shows the same story in the movement report", async () => {
    asAccounts();
    const report = await getPettyCashReport({
      floatId,
      from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      to: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const net = toDecimal(report.totals.net);
    const opening = toDecimal(
      (await db.pettyCashFloat.findUniqueOrThrow({ where: { id: floatId } })).openingBalance,
    );
    expectDecimal(opening.plus(net), await balance(), "opening + net movement");
    // A reversed voucher appears twice — the outflow and the inflow.
    const kinds = report.movements.map((m) => m.kind);
    expect(kinds).toContain("VOUCHER_OUT");
    expect(kinds).toContain("TOPUP_IN");
    expect(kinds).toContain("REVERSAL_IN");
  });

  it("is not readable by the desks that cannot spend it", async () => {
    for (const become of [asChef, asStore, asDelivery]) {
      become();
      await expectRefused(() =>
        getPettyCashReport({ floatId, from: new Date(0), to: new Date() }),
      );
      await expectRefused(() => getPettyCashFloat(floatId));
    }
  });
});
