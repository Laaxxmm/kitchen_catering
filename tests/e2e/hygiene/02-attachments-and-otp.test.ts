import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import {
  DeliveryStatus,
  DocumentEntityType,
  DocumentKind,
  OrderChannel,
} from "@prisma/client";
import { db } from "@/server/db";
import { uploadDocument } from "@/server/actions/documents";
import { createPettyCashFloat, createPettyCashVoucher } from "@/server/actions/petty-cash";
import { confirmDeliveryOTP, dispatchDelivery, scheduleDelivery } from "@/server/actions/deliveries";
import { markIngredientsAvailable } from "@/server/actions/chef-requisitions";
import { markOrderCooked, startCookingOrder } from "@/server/actions/production-jobs";
import {
  asAccounts,
  asChef,
  asDelivery,
  asManager,
  asStore,
  chefAccepts,
  daysFromNow,
  desk,
  ensureSeeded,
  expectRefused,
  istInput,
  mustOk,
  placeCateringOrder,
  read,
} from "../harness";

/**
 * Two more go-live findings.
 *
 * 3. uploadDocument took the entity id straight from the client and never
 *    looked at it — any desk in a wide write set could staple a file to any
 *    supplier bill, or to nothing at all.
 * 4. confirmDeliveryOTP verified the OTP only when the caller sent one, so
 *    omitting it skipped the check. Only legacy rows carry a hash now
 *    (scheduleDelivery leaves it null), which is why it needed closing
 *    rather than deleting.
 */

const FAKE_PDF = Buffer.from("%PDF-1.4\n% e2e hygiene attachment\n").toString("base64");
/** A cuid-shaped id that matches nothing. */
const MISSING_ID = "cmissingmissingmissingmis";

const documentCount = (entityId: string) => db.document.count({ where: { entityId } });

beforeAll(async () => {
  await ensureSeeded();
});

describe("stapling a file to a record", () => {
  let orderId: string;
  let voucherId: string;

  beforeAll(async () => {
    orderId = (await placeCateringOrder({ headcount: 30, packageTotal: "60000" })).id;

    asAccounts();
    const float = mustOk(
      await createPettyCashFloat({
        custodianId: desk("accounts").id,
        name: "Hygiene Float",
        openingBalance: "10000",
      }),
      "open float",
    );
    voucherId = mustOk(
      await createPettyCashVoucher({
        floatId: float.id,
        amount: "500",
        category: "SUPPLIES",
        paidTo: "Local market",
        reason: "hygiene fixture",
      }),
      "post voucher",
    ).id;
  });

  it("refuses an entity id that matches nothing, and writes no row", async () => {
    asStore();
    const message = await expectRefused(() =>
      uploadDocument({
        entityType: DocumentEntityType.VENDOR_BILL,
        entityId: MISSING_ID,
        base64: FAKE_PDF,
        fileName: "ghost-bill.pdf",
      }),
    );
    expect(message).toMatch(/no vendor bill/i);
    expect(await documentCount(MISSING_ID)).toBe(0);
  });

  it("refuses a desk with no business on that kind of record", async () => {
    // The driver holds delivery paperwork, not the cash tin's vouchers.
    asDelivery();
    const message = await expectRefused(() =>
      uploadDocument({
        entityType: DocumentEntityType.PETTY_CASH_VOUCHER,
        entityId: voucherId,
        base64: FAKE_PDF,
        fileName: "not-mine.pdf",
      }),
    );
    expect(message).toMatch(/petty cash voucher/i);
    expect(await documentCount(voucherId)).toBe(0);
  });

  it("still lets the desks that hold the paper attach it", async () => {
    // uploadDocument returns the stored row, not an {ok} result.
    asAccounts();
    const receipt = await uploadDocument({
      entityType: DocumentEntityType.PETTY_CASH_VOUCHER,
      entityId: voucherId,
      base64: FAKE_PDF,
      fileName: "receipt.pdf",
      kind: DocumentKind.ORIGINAL,
    });
    expect(receipt.fileName).toBe("receipt.pdf");

    asStore();
    await uploadDocument({
      entityType: DocumentEntityType.ORDER,
      entityId: orderId,
      base64: FAKE_PDF,
      fileName: "packing-note.pdf",
    });
    expect(await documentCount(voucherId)).toBe(1);
    expect(await documentCount(orderId)).toBe(1);
  });
});

describe("a delivery that still carries an OTP hash", () => {
  let deliveryId: string;

  beforeAll(async () => {
    const order = await placeCateringOrder({ headcount: 20, packageTotal: "40000" });
    await chefAccepts(order.id);
    asChef();
    mustOk(await markIngredientsAvailable(order.id, "kitchen stocked"), "ingredients available");
    mustOk(await startCookingOrder(order.id), "start cooking");
    mustOk(await markOrderCooked(order.id), "mark cooked");

    asManager();
    deliveryId = mustOk(
      await scheduleDelivery({
        orderId: order.id,
        driverUserId: desk("delivery").id,
        scheduledAt: istInput(daysFromNow(7)),
      }),
      "schedule delivery",
    ).id;

    asDelivery();
    mustOk(await dispatchDelivery(deliveryId), "dispatch delivery");

    // scheduleDelivery leaves otpHash null — the readback step is retired —
    // so a row carrying one can only be pre-existing. Plant it directly.
    await db.delivery.update({
      where: { id: deliveryId },
      data: { otpHash: await bcrypt.hash("1234", 10) },
    });
  });

  it("is not confirmable by leaving the OTP out", async () => {
    asDelivery();
    const message = await expectRefused(() => confirmDeliveryOTP(deliveryId, {}));
    expect(message).toMatch(/otp/i);
    expect((await read.delivery(deliveryId)).status).toBe(DeliveryStatus.DISPATCHED);
  });

  it("is not confirmable with the wrong OTP", async () => {
    asDelivery();
    const message = await expectRefused(() => confirmDeliveryOTP(deliveryId, { otp: "9999" }));
    expect(message).toContain("did not match");
    expect((await read.delivery(deliveryId)).status).toBe(DeliveryStatus.DISPATCHED);
  });

  it("hands over on the right OTP", async () => {
    asDelivery();
    mustOk(await confirmDeliveryOTP(deliveryId, { otp: "1234" }), "confirm with the OTP");
    expect((await read.delivery(deliveryId)).status).toBe(DeliveryStatus.DELIVERED);
  });

  it("still confirms a modern delivery, which carries no hash at all", async () => {
    const order = await placeCateringOrder({
      headcount: 10,
      packageTotal: "20000",
      channel: OrderChannel.ODC,
    });
    await chefAccepts(order.id);
    asChef();
    mustOk(await markIngredientsAvailable(order.id, "kitchen stocked"), "ingredients available");
    mustOk(await startCookingOrder(order.id), "start cooking");
    mustOk(await markOrderCooked(order.id), "mark cooked");

    asManager();
    const scheduled = mustOk(
      await scheduleDelivery({
        orderId: order.id,
        driverUserId: desk("delivery").id,
        scheduledAt: istInput(daysFromNow(7)),
      }),
      "schedule delivery",
    );
    asDelivery();
    mustOk(await dispatchDelivery(scheduled.id), "dispatch delivery");
    mustOk(await confirmDeliveryOTP(scheduled.id, {}), "confirm without an OTP");
    expect((await read.delivery(scheduled.id)).status).toBe(DeliveryStatus.DELIVERED);
  });
});
