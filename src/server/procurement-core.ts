import { Prisma, ProcurementType, VendorPOStatus } from "@prisma/client";
import { toDecimal } from "@/lib/money";
import { indefineStateCode } from "@/lib/org";
import { summarise } from "@/lib/gst";
import { nextVendorPONumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { ActionError } from "@/server/action-result";
import type { VendorPOCreateInputT } from "@/lib/validators";

// The vendor-PO creation core, shared by the procurement action
// (createVendorPO) and the banquet requisition "raise PO for shortfall"
// action. Lives outside the "use server" files so it (a) never becomes an
// ungated server-action endpoint, (b) can run inside a CALLER-owned
// transaction (the banquet flow creates the PO and links the requisition
// line atomically), and (c) doesn't force banquet.ts ⇄ procurement.ts
// circular imports. Callers are responsible for the role gate and for
// validating the input (VendorPOCreateInput).
export async function createVendorPOTx(
  tx: Prisma.TransactionClient,
  userId: string,
  input: VendorPOCreateInputT,
) {
  for (const l of input.lines) {
    // A line buys stock for exactly one ledger: kitchen (Ingredient) or
    // banquet store (BanquetItem). Both set would double-post on GRN.
    if (l.ingredientId && l.banquetItemId) {
      throw new ActionError(
        "A PO line can link to an ingredient or a banquet item — not both.",
      );
    }
  }

  const supplierState = indefineStateCode();
  const summary = summarise({
    lines: input.lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPct: "0",
      gstRatePct: l.gstRatePct ?? "0",
    })),
    supplierStateCode: supplierState,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode,
  });
  // Every PO runs the tiered approval engine: born DRAFT, then on submit it
  // routes to Manager (< ₹5k) or Admin (≥ ₹5k) for sign-off. The store keeper
  // raises it for a kitchen shortfall or low-stock reorder; management approves.
  const tier = "tiered";

  const poNo = await nextVendorPONumber(tx);
  const created = await tx.vendorPO.create({
    data: {
      poNo,
      vendorId: input.vendorId,
      orderId: input.orderId ?? null,
      procurementType: (input.procurementType as ProcurementType) ?? ProcurementType.STANDARD,
      status: VendorPOStatus.DRAFT,
      issueDate: new Date(),
      expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
      placeOfSupplyStateCode: input.placeOfSupplyStateCode,
      subtotal: summary.subtotal.toString(),
      taxTotal: summary.taxTotal.toString(),
      grandTotal: summary.grandTotal.toString(),
      approvalTier: tier,
      notes: input.notes ?? null,
      lines: {
        create: input.lines.map((l, idx) => {
          const q = toDecimal(l.quantity);
          const u = toDecimal(l.unitPrice);
          const g = toDecimal(l.gstRatePct ?? "0").div(100);
          const sub = q.times(u);
          const tax = sub.times(g);
          return {
            sortOrder: idx,
            ingredientId: l.ingredientId ?? null,
            banquetItemId: l.banquetItemId ?? null,
            sku: l.sku,
            description: l.description,
            unit: l.unit,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            gstRatePct: l.gstRatePct ?? "0",
            lineSubtotal: sub.toDecimalPlaces(2).toString(),
            lineTax: tax.toDecimalPlaces(2).toString(),
            lineTotal: sub.plus(tax).toDecimalPlaces(2).toString(),
          };
        }),
      },
    },
    // Callers linking downstream records (banquet requisition lines) need
    // the created line ids back.
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  await tx.auditLog.create({
    data: {
      userId,
      action: "VENDOR_PO_CREATED",
      entity: "VendorPO",
      entityId: created.id,
      payloadHash: sha256Json({
        poNo,
        vendorId: input.vendorId,
        total: summary.grandTotal.toString(),
        tier,
      }),
    },
  });

  return created;
}
