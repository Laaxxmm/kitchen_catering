"use server";

import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { sha256Json } from "@/lib/audit";

// One-shot "clean slate" — wipes every transactional row so the team can
// start fresh, while KEEPING master data (users, customers, dishes, recipes,
// ingredients, vendors, settings, salary structures, task presets, rooms/
// staff, and the department item catalogues). Mirrors prisma/reset-
// transactional.ts but runs in-app (ADMIN only, typed confirmation) so it
// can be triggered against production without the CLI.

const CONFIRM_PHRASE = "RESET";

export interface ResetSummary {
  orders: number;
  quotes: number;
  invoices: number;
  notifications: number;
  tasks: number;
  auditRows: number;
}

export async function resetTransactionalData(confirm: string): Promise<ResetSummary> {
  const session = await requireRole([Role.ADMIN]);
  if (confirm !== CONFIRM_PHRASE) {
    throw new Error(`Type ${CONFIRM_PHRASE} to confirm the clean slate.`);
  }

  const summary = await db.$transaction(
    async (tx) => {
      // ── Anything that references an Order with a RESTRICT FK must be
      //    deleted BEFORE the orders themselves. TimeEntry.orderId is the
      //    easy-to-miss one (labour logged against an order).
      await tx.timeEntry.deleteMany();

      // Vendor bills
      await tx.vendorBillPayment.deleteMany();
      await tx.vendorBillLine.deleteMany();
      await tx.vendorBill.deleteMany();

      // GRNs (receipts first, then GRN lines, then GRNs)
      await tx.ingredientReceipt.deleteMany();
      await tx.gRNLine.deleteMany();
      await tx.gRN.deleteMany();

      // Vendor POs (reference Order)
      await tx.vendorPOLine.deleteMany();
      await tx.vendorPO.deleteMany();

      // Purchase requisitions (reference Order)
      await tx.purchaseRequisitionLine.deleteMany();
      await tx.purchaseRequisition.deleteMany();

      // Ingredient movements (issues reference Order)
      await tx.ingredientIssue.deleteMany();
      await tx.ingredientAdjustment.deleteMany();

      // Production (references Order)
      await tx.productionJobItem.deleteMany();
      await tx.productionJob.deleteMany();

      // Deliveries (reference Order)
      await tx.deliveryAttempt.deleteMany();
      await tx.delivery.deleteMany();

      // Customer invoices (reference Order)
      await tx.customerInvoicePayment.deleteMany();
      await tx.customerInvoiceLine.deleteMany();
      const invoices = await tx.customerInvoice.deleteMany();

      // Chef requisitions (reference Order)
      await tx.chefRequisitionLine.deleteMany();
      await tx.chefRequisition.deleteMany();

      // Quotes (a converted quote references its Order)
      await tx.quoteLine.deleteMany();
      await tx.quoteEvent.deleteMany();
      const quotes = await tx.quote.deleteMany();

      // Orders — OrderItem / budget / overhead lines cascade automatically.
      const orders = await tx.order.deleteMany();

      // Finance / HR
      await tx.pettyCashVoucher.deleteMany();
      await tx.pettyCashTopUp.deleteMany();
      await tx.pettyCashFloat.deleteMany();
      await tx.salaryRunLine.deleteMany();
      await tx.salaryRun.deleteMany();
      await tx.eInvoiceLog.deleteMany();

      // Other departments — housekeeping / maintenance / banquet
      await tx.housekeepingIssueLine.deleteMany();
      await tx.housekeepingIssue.deleteMany();
      await tx.housekeepingReceiptLine.deleteMany();
      await tx.housekeepingReceipt.deleteMany();
      await tx.maintenanceActivityLine.deleteMany();
      await tx.maintenanceActivity.deleteMany();
      await tx.maintenanceReceiptLine.deleteMany();
      await tx.maintenanceReceipt.deleteMany();
      await tx.banquetIssueLine.deleteMany();
      await tx.banquetIssue.deleteMany();
      await tx.banquetReceiptLine.deleteMany();
      await tx.banquetReceipt.deleteMany();

      // Tasks, mobile sessions, attachments, notifications, audit log
      const tasks = await tx.task.deleteMany();
      await tx.mobileOp.deleteMany();
      await tx.mobileSession.deleteMany();
      await tx.document.deleteMany();
      const notifs = await tx.notification.deleteMany();
      const audit = await tx.auditLog.deleteMany();

      // FY document-number sequences — restart numbering at 0001.
      await tx.orderCodeSequence.deleteMany();
      await tx.quoteNumberSequence.deleteMany();
      await tx.customerInvoiceNumberSequence.deleteMany();
      await tx.requisitionNumberSequence.deleteMany();
      await tx.vendorPONumberSequence.deleteMany();
      await tx.gRNNumberSequence.deleteMany();
      await tx.vendorBillNumberSequence.deleteMany();
      await tx.productionJobNumberSequence.deleteMany();
      await tx.deliveryNumberSequence.deleteMany();
      await tx.pettyCashVoucherNumberSequence.deleteMany();
      await tx.salaryRunNumberSequence.deleteMany();
      await tx.chefRequisitionNumberSequence.deleteMany();

      // Reset stock to opening (ingredients) / zero (dept items, no opening).
      await tx.$executeRaw`UPDATE "Ingredient" SET "onHandQty" = "openingQty", "avgUnitCost" = "openingAvgCost"`;
      await tx.$executeRaw`UPDATE "HousekeepingItem" SET "currentStock" = 0, "inCirculation" = 0`;
      await tx.$executeRaw`UPDATE "MaintenanceItem" SET "currentStock" = 0`;
      await tx.$executeRaw`UPDATE "BanquetItem" SET "currentStock" = 0`;

      return {
        orders: orders.count,
        quotes: quotes.count,
        invoices: invoices.count,
        notifications: notifs.count,
        tasks: tasks.count,
        auditRows: audit.count,
      };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  // Record the reset itself AFTER the wipe, so there's one fresh audit row
  // naming who pressed the button (the old audit log was just cleared).
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "TRANSACTIONAL_RESET",
      entity: "System",
      entityId: "clean-slate",
      payloadHash: sha256Json({ ordersDeleted: summary.orders, at: "in-app" }),
    },
  });

  // Refresh the heavy dashboards so they come up empty immediately.
  revalidatePath("/dashboard");
  revalidatePath("/orders");
  revalidatePath("/invoices");
  revalidatePath("/notifications");

  return summary;
}
