/**
 * One-shot transactional-data reset for Indefine Kitchen.
 *
 * Wipes every transactional row in the database so the dashboards
 * come up clean. Keeps master data (users, customers, customer groups,
 * dishes, recipes, ingredients, vendors, settings, salary structures)
 * so the app is immediately usable with the same accounts and catalogue.
 *
 * Resets:
 *   - All orders, order items, chef requisitions + lines
 *   - All production jobs + items
 *   - All deliveries + attempts
 *   - All quotes + lines + events
 *   - All customer invoices + lines + payments
 *   - All purchase requisitions + lines
 *   - All vendor POs + lines, GRNs + lines, vendor bills + lines + payments
 *   - All ingredient receipts, issues, returns, adjustments, stock transfers
 *   - All petty cash floats, vouchers, top-ups
 *   - All salary runs + lines
 *   - All e-invoice logs
 *   - All housekeeping / maintenance / banquet receipts + issues + lines
 *   - All tasks (task presets kept), time entries, mobile sessions + op-log
 *   - All uploaded documents (attachments to the deleted entities)
 *   - All notifications (everyone's inbox)
 *   - All audit log rows (truly clean slate)
 *   - All FY sequence rows (so the next document numbers start at 0001)
 *   - Ingredient.onHandQty back to openingQty + avgUnitCost back to openingAvgCost
 *   - Housekeeping / maintenance / banquet item stock back to 0
 *
 * Usage:
 *   npm run db:reset-transactional
 *
 * Designed to be re-runnable — no FK violations on a fresh DB.
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("🧹 Resetting transactional data — this is destructive but keeps master records.");

  await db.$transaction(
    async (tx) => {
      // ── Procurement / inventory side ──────────────────────────────────
      // Children before parents.

      // Vendor bills
      const vbpDel = await tx.vendorBillPayment.deleteMany();
      const vblDel = await tx.vendorBillLine.deleteMany();
      const vbDel = await tx.vendorBill.deleteMany();

      // GRNs (GRNLine has IngredientReceipt linkage via grnLineId, but
      // IngredientReceipt is the parent direction — we delete receipts
      // first, then GRN lines, then GRNs.)
      const irDel = await tx.ingredientReceipt.deleteMany();
      const grnLineDel = await tx.gRNLine.deleteMany();
      const grnDel = await tx.gRN.deleteMany();

      // Vendor POs
      const poLineDel = await tx.vendorPOLine.deleteMany();
      const poDel = await tx.vendorPO.deleteMany();

      // Purchase requisitions
      const prLineDel = await tx.purchaseRequisitionLine.deleteMany();
      const prDel = await tx.purchaseRequisition.deleteMany();

      // Ingredient movements (non-receipt). Kitchen returns hang off the
      // ISSUE they reverse, not off the order, so nothing cascades them —
      // and their RESTRICT FK blocks the issue delete outright, which took
      // this whole script down the moment one return existed.
      const irlDel = await tx.ingredientReturnLine.deleteMany();
      const iretDel = await tx.ingredientReturn.deleteMany();
      const iiDel = await tx.ingredientIssue.deleteMany();
      const iaDel = await tx.ingredientAdjustment.deleteMany();
      // Inter-store transfers are movement documents like any other: stock
      // is rewound to opening below, so leaving them would leave the stock
      // ledger reporting movements with nothing behind them.
      const stDel = await tx.stockTransfer.deleteMany();

      // ── Sales / kitchen side ─────────────────────────────────────────

      // Production
      const pjiDel = await tx.productionJobItem.deleteMany();
      const pjDel = await tx.productionJob.deleteMany();

      // Deliveries
      const daDel = await tx.deliveryAttempt.deleteMany();
      const delDel = await tx.delivery.deleteMany();

      // Customer invoices
      const cipDel = await tx.customerInvoicePayment.deleteMany();
      const cilDel = await tx.customerInvoiceLine.deleteMany();
      const ciDel = await tx.customerInvoice.deleteMany();

      // Chef requisitions
      const crLineDel = await tx.chefRequisitionLine.deleteMany();
      const crDel = await tx.chefRequisition.deleteMany();

      // Quotes
      const qlDel = await tx.quoteLine.deleteMany();
      const qeDel = await tx.quoteEvent.deleteMany();
      const qDel = await tx.quote.deleteMany();

      // Orders
      const oiDel = await tx.orderItem.deleteMany();
      const obDel = await tx.orderBudgetLine.deleteMany().catch(() => ({ count: 0 }));
      const orderDel = await tx.order.deleteMany();

      // ── Finance / HR ──────────────────────────────────────────────────

      const pcvDel = await tx.pettyCashVoucher.deleteMany();
      const pctDel = await tx.pettyCashTopUp.deleteMany();
      const pcfDel = await tx.pettyCashFloat.deleteMany();

      const srlDel = await tx.salaryRunLine.deleteMany();
      const srDel = await tx.salaryRun.deleteMany();
      // SalaryStructure kept — it's per-user master config.

      // E-invoice
      const eilDel = await tx.eInvoiceLog.deleteMany();

      // ── Other departments — housekeeping / maintenance / banquet ──────
      // Lines before headers. The item catalogues stay; their stock is
      // reset to 0 below (they have no "opening" balance concept).
      const hkIlDel = await tx.housekeepingIssueLine.deleteMany();
      const hkIDel = await tx.housekeepingIssue.deleteMany();
      const hkRlDel = await tx.housekeepingReceiptLine.deleteMany();
      const hkRDel = await tx.housekeepingReceipt.deleteMany();

      const mtAlDel = await tx.maintenanceActivityLine.deleteMany();
      const mtADel = await tx.maintenanceActivity.deleteMany();
      const mtRlDel = await tx.maintenanceReceiptLine.deleteMany();
      const mtRDel = await tx.maintenanceReceipt.deleteMany();

      const bqIlDel = await tx.banquetIssueLine.deleteMany();
      const bqIDel = await tx.banquetIssue.deleteMany();
      const bqRlDel = await tx.banquetReceiptLine.deleteMany();
      const bqRDel = await tx.banquetReceipt.deleteMany();

      // ── Tasks, attendance, mobile sessions, attachments ───────────────
      // Task presets (TaskTemplate) stay — they're reusable master config.
      const taskDel = await tx.task.deleteMany();
      const teDel = await tx.timeEntry.deleteMany();
      // Mobile op-log + auth sessions; registered devices (MobileDevice) stay.
      const moDel = await tx.mobileOp.deleteMany();
      const msDel = await tx.mobileSession.deleteMany();
      // Documents are attachments to the entities we just deleted.
      const docDel = await tx.document.deleteMany();

      // ── Notifications — wipe everyone's inbox for a clean start ───────
      const notifDel = await tx.notification.deleteMany();

      // ── Audit log ─────────────────────────────────────────────────────
      const alDel = await tx.auditLog.deleteMany();

      // ── FY sequences — wipe so doc numbers restart from 0001 ─────────
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
      // VendorCodeSequence intentionally kept — vendors are master data
      // and their existing V-XXXX codes stay valid.

      // ── Reset ingredient stock to opening levels ─────────────────────
      // (Single raw UPDATE — faster + no row-by-row roundtrips.)
      const stockReset = await tx.$executeRaw`
        UPDATE "Ingredient"
        SET "onHandQty" = "openingQty",
            "avgUnitCost" = "openingAvgCost"
      `;

      // Department item stock has no "opening" balance — it's built up
      // entirely from receipts we just deleted, so reset it to 0. The item
      // catalogues themselves (names, units, reusable flags) are kept.
      await tx.$executeRaw`UPDATE "HousekeepingItem" SET "currentStock" = 0, "inCirculation" = 0`;
      await tx.$executeRaw`UPDATE "MaintenanceItem" SET "currentStock" = 0`;
      await tx.$executeRaw`UPDATE "BanquetItem" SET "currentStock" = 0`;

      console.log("Deleted rows:");
      console.log(`  Orders:                  ${orderDel.count}`);
      console.log(`  Order items:             ${oiDel.count}`);
      console.log(`  Order budget lines:      ${obDel.count}`);
      console.log(`  Quotes:                  ${qDel.count}`);
      console.log(`  Quote lines:             ${qlDel.count}`);
      console.log(`  Quote events:            ${qeDel.count}`);
      console.log(`  Chef requisitions:       ${crDel.count}`);
      console.log(`  Chef requisition lines:  ${crLineDel.count}`);
      console.log(`  Production jobs:         ${pjDel.count}`);
      console.log(`  Production job items:    ${pjiDel.count}`);
      console.log(`  Deliveries:              ${delDel.count}`);
      console.log(`  Delivery attempts:       ${daDel.count}`);
      console.log(`  Customer invoices:       ${ciDel.count}`);
      console.log(`  Customer invoice lines:  ${cilDel.count}`);
      console.log(`  Customer invoice pmts:   ${cipDel.count}`);
      console.log(`  Purchase reqs:           ${prDel.count}`);
      console.log(`  Purchase req lines:      ${prLineDel.count}`);
      console.log(`  Vendor POs:              ${poDel.count}`);
      console.log(`  Vendor PO lines:         ${poLineDel.count}`);
      console.log(`  GRNs:                    ${grnDel.count}`);
      console.log(`  GRN lines:               ${grnLineDel.count}`);
      console.log(`  Vendor bills:            ${vbDel.count}`);
      console.log(`  Vendor bill lines:       ${vblDel.count}`);
      console.log(`  Vendor bill payments:    ${vbpDel.count}`);
      console.log(`  Ingredient receipts:     ${irDel.count}`);
      console.log(`  Ingredient issues:       ${iiDel.count}`);
      console.log(`  Ingredient returns:      ${iretDel.count}  (lines ${irlDel.count})`);
      console.log(`  Ingredient adjustments:  ${iaDel.count}`);
      console.log(`  Stock transfers:         ${stDel.count}`);
      console.log(`  Petty cash vouchers:     ${pcvDel.count}`);
      console.log(`  Petty cash top-ups:      ${pctDel.count}`);
      console.log(`  Petty cash floats:       ${pcfDel.count}`);
      console.log(`  Salary runs:             ${srDel.count}`);
      console.log(`  Salary run lines:        ${srlDel.count}`);
      console.log(`  E-invoice logs:          ${eilDel.count}`);
      console.log(`  Housekeeping receipts:   ${hkRDel.count}  (lines ${hkRlDel.count})`);
      console.log(`  Housekeeping issues:     ${hkIDel.count}  (lines ${hkIlDel.count})`);
      console.log(`  Maintenance receipts:    ${mtRDel.count}  (lines ${mtRlDel.count})`);
      console.log(`  Maintenance activities:  ${mtADel.count}  (lines ${mtAlDel.count})`);
      console.log(`  Banquet receipts:        ${bqRDel.count}  (lines ${bqRlDel.count})`);
      console.log(`  Banquet issues:          ${bqIDel.count}  (lines ${bqIlDel.count})`);
      console.log(`  Tasks:                   ${taskDel.count}`);
      console.log(`  Time entries:            ${teDel.count}`);
      console.log(`  Mobile ops / sessions:   ${moDel.count} / ${msDel.count}`);
      console.log(`  Documents:               ${docDel.count}`);
      console.log(`  Notifications:           ${notifDel.count}`);
      console.log(`  Audit log entries:       ${alDel.count}`);
      console.log(`  Ingredient stock rows reset: ${stockReset}`);
    },
    {
      // The default 5s timeout is too short for a full purge; give it
      // headroom in case the table sizes grow.
      timeout: 60_000,
      maxWait: 5_000,
    },
  );

  console.log("\n✅ Done. Master data preserved: users, customers, dishes, recipes,");
  console.log("   ingredients, vendors, settings, salary structures, task presets,");
  console.log("   rooms/staff, and the housekeeping/maintenance/banquet item catalogues.");
  console.log("All document number sequences will restart at 0001.");
}

main()
  .catch((err) => {
    console.error("\n❌ Reset failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
