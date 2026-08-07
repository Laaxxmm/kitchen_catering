import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createPettyCashFloat, topUpPettyCash } from "@/server/actions/petty-cash";
import {
  asAccounts,
  desk,
  ensureSeeded,
  expectDecimal,
  mustOk,
  read,
} from "../harness";

/**
 * Finding 6: the code said an over-₹10,000 top-up "needs MANAGER+ approval"
 * and then didn't ask for one — and ACCOUNTS, who the action admits, signs
 * their own. Whether the finance desk should be able to refill the tin from
 * the bank unaided is the client's call, not a bug to fix on the way out of
 * the door, so the BEHAVIOUR is deliberately unchanged and the comment was
 * corrected instead.
 *
 * This pins what the code actually does, so the comment can't drift back:
 * the threshold is an audit breadcrumb, not a gate.
 */

let floatId: string;

beforeAll(async () => {
  await ensureSeeded();
  asAccounts();
  floatId = mustOk(
    await createPettyCashFloat({
      custodianId: desk("accounts").id,
      name: "Hygiene Threshold Float",
      openingBalance: "1000",
    }),
    "open float",
  ).id;
});

describe("a top-up over the ₹10,000 threshold", () => {
  it("is posted by the finance desk on their own signature", async () => {
    asAccounts();
    mustOk(
      await topUpPettyCash({
        floatId,
        amount: "12000",
        source: "BANK",
        reference: "NEFT-HYGIENE-1",
      }),
      "over-threshold top-up",
    );

    const row = await db.pettyCashFloat.findUniqueOrThrow({ where: { id: floatId } });
    expectDecimal(row.currentBalance, "13000", "balance after the top-up");
    // The top-up records the poster as its own approver — there is no second
    // signature anywhere in the flow.
    const topUp = await db.pettyCashTopUp.findFirstOrThrow({ where: { floatId } });
    expect(topUp.approvedByUserId).toBe(desk("accounts").id);
    expect(topUp.approvedAt).not.toBeNull();
  });

  it("leaves the threshold as a breadcrumb in the audit trail", async () => {
    expect(await read.auditActions("PettyCashFloat", floatId)).toContain(
      "PETTY_CASH_TOP_UP_OVER_THRESHOLD",
    );
  });
});
