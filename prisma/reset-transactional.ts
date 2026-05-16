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
 *   - All ingredient receipts, issues, adjustments
 *   - All petty cash floats, vouchers, top-ups
 *   - All salary runs + lines
 *   - All e-invoice logs
 *   - All audit log rows (truly clean slate)
 *   - All FY sequence rows (so the next document numbers start at 0001)
 *   - Ingredient.onHandQty back to openingQty + avgUnitCost back to openingAvgCost
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

      // Ingredient movements (non-receipt)
      const iiDel = await tx.ingredientIssue.deleteMany();
      const iaDel = await tx.ingredientAdjustment.deleteMany();

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
      console.log(`  Ingredient adjustments:  ${iaDel.count}`);
      console.log(`  Petty cash vouchers:     ${pcvDel.count}`);
      console.log(`  Petty cash top-ups:      ${pctDel.count}`);
      console.log(`  Petty cash floats:       ${pcfDel.count}`);
      console.log(`  Salary runs:             ${srDel.count}`);
      console.log(`  Salary run lines:        ${srlDel.count}`);
      console.log(`  E-invoice logs:          ${eilDel.count}`);
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

  console.log("\n✅ Done. Master data (users, customers, dishes, ingredients, vendors, settings) preserved.");
  console.log("All document number sequences will restart at 0001.");
}

main()
  .catch((err) => {
    console.error("\n❌ Reset failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
