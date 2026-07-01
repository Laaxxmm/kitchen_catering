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
const CLEAR_ORDERS_PHRASE = "CLEAR ORDERS";

export interface ResetSummary {
  orders: number;
  quotes: number;
  invoices: number;
  notifications: number;
  tasks: number;
  auditRows: number;
}

export interface ClearOrdersSummary {
  orders: number;
  quotes: number;
  deliveries: number;
  chefRequisitions: number;
  productionJobs: number;
  tasks: number;
  notifications: number;
  /** Finance rows deliberately preserved — surfaced so the admin can see
   *  exactly what survived the clear. */
  invoicesKept: number;
  vendorBillsKept: number;
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

/**
 * Selective clean-up — clears the OPERATIONAL order pipeline while KEEPING
 * every finance / accounts record intact:
 *
 *   Deleted   orders (+ items / budget / overhead), quotes, chef requisitions,
 *             production jobs, deliveries, order-tied ingredient issues, labour
 *             time entries, legacy purchase requisitions, tasks, notifications.
 *   Kept      customer invoices + payments (AR), vendor bills + payments (AP),
 *             vendor POs, GRNs, ingredient receipts, petty cash, salary runs,
 *             e-invoice logs — and the full audit log.
 *
 * Finance records that pointed at a now-deleted order (customer invoices,
 * vendor POs) keep the record but have their orderId detached (set null), so
 * the money survives without a dangling foreign key. Stock on-hand is left
 * exactly as it stands — deleting historical movement rows doesn't change the
 * stored quantity. Only the operational document sequences restart; invoice /
 * PO / GRN / bill numbering continues so finance stays gap-free.
 *
 * ADMIN-only, gated behind typing "CLEAR ORDERS".
 */
export async function clearOrdersKeepFinance(confirm: string): Promise<ClearOrdersSummary> {
  const session = await requireRole([Role.ADMIN]);
  if (confirm !== CLEAR_ORDERS_PHRASE) {
    throw new Error(`Type ${CLEAR_ORDERS_PHRASE} to confirm.`);
  }

  const summary = await db.$transaction(
    async (tx) => {
      // Labour logged against orders (RESTRICT FK — must go before orders).
      await tx.timeEntry.deleteMany();

      // Order-tied stock issues (reference order + prLine + chefReqLine +
      // production job — so they must be deleted before all of those).
      await tx.ingredientIssue.deleteMany();

      // Production.
      await tx.productionJobItem.deleteMany();
      const productionJobs = await tx.productionJob.deleteMany();

      // Deliveries.
      await tx.deliveryAttempt.deleteMany();
      const deliveries = await tx.delivery.deleteMany();

      // Chef requisitions (lines reference OrderItem, which cascades on order
      // delete — so clear the requisition lines first).
      await tx.chefRequisitionLine.deleteMany();
      const chefRequisitions = await tx.chefRequisition.deleteMany();

      // Legacy purchase requisitions (reference order).
      await tx.purchaseRequisitionLine.deleteMany();
      await tx.purchaseRequisition.deleteMany();

      // Detach the KEPT finance records from the orders we're about to delete
      // so the money survives with no dangling FK.
      await tx.customerInvoice.updateMany({ data: { orderId: null } });
      await tx.vendorPO.updateMany({ data: { orderId: null } });

      // Quotes (a converted quote references its order).
      await tx.quoteLine.deleteMany();
      await tx.quoteEvent.deleteMany();
      const quotes = await tx.quote.deleteMany();

      // Orders — OrderItem / budget / overhead lines cascade automatically.
      const orders = await tx.order.deleteMany();

      // Operational clutter (regenerates as work resumes).
      const tasks = await tx.task.deleteMany();
      const notifs = await tx.notification.deleteMany();

      // Restart ONLY the operational document sequences. Finance numbering
      // (invoices, POs, GRNs, bills, petty cash, salary) is left alone so the
      // books stay continuous and gap-free.
      await tx.orderCodeSequence.deleteMany();
      await tx.quoteNumberSequence.deleteMany();
      await tx.requisitionNumberSequence.deleteMany();
      await tx.chefRequisitionNumberSequence.deleteMany();
      await tx.productionJobNumberSequence.deleteMany();
      await tx.deliveryNumberSequence.deleteMany();

      const [invoicesKept, vendorBillsKept] = await Promise.all([
        tx.customerInvoice.count(),
        tx.vendorBill.count(),
      ]);

      return {
        orders: orders.count,
        quotes: quotes.count,
        deliveries: deliveries.count,
        chefRequisitions: chefRequisitions.count,
        productionJobs: productionJobs.count,
        tasks: tasks.count,
        notifications: notifs.count,
        invoicesKept,
        vendorBillsKept,
      };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  // Audit trail is KEPT for this variant — add one row naming who ran it.
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "ORDERS_CLEARED_KEEP_FINANCE",
      entity: "System",
      entityId: "clear-orders",
      payloadHash: sha256Json({
        ordersDeleted: summary.orders,
        invoicesKept: summary.invoicesKept,
        vendorBillsKept: summary.vendorBillsKept,
        at: "in-app",
      }),
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/orders");
  revalidatePath("/notifications");

  return summary;
}
