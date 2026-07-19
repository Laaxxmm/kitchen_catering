import { ChefRequisitionLineStatus, Prisma, ProcurementType, VendorPOStatus } from "@prisma/client";
import { indefineStateCode } from "@/lib/org";
import { computeLine, summarise } from "@/lib/gst";
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
    // decimalString lets "" through (it's a legitimate "not provided"
    // elsewhere) — here a blank number would crash the money math.
    if (!l.quantity.trim()) {
      throw new ActionError(`Line "${l.description}": enter the quantity.`);
    }
    if (!l.unitPrice.trim()) {
      throw new ActionError(`Line "${l.description}": enter the unit price (0 is fine).`);
    }
  }

  // Store-created vendors need GM/Admin sign-off before money moves on them.
  const vendor = await tx.vendor.findUnique({
    where: { id: input.vendorId },
    select: { approvalStatus: true, name: true },
  });
  if (!vendor) throw new ActionError("Vendor not found — refresh and pick again.");
  if (vendor.approvalStatus !== "APPROVED") {
    throw new ActionError(
      `"${vendor.name}" is awaiting approval — ask a manager to approve them first.`,
    );
  }

  const supplierState = indefineStateCode();
  const summary = summarise({
    lines: input.lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPct: "0",
      gstRatePct: l.gstRatePct?.trim() || "0",
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
          // Per-line round-then-sum via gst.computeLine — same convention the
          // header summarise() uses, so stored line amounts and the header
          // totals agree (and match an edited PO's lines byte-for-byte).
          const { subtotal, tax, total } = computeLine({
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPct: "0",
            gstRatePct: l.gstRatePct?.trim() || "0",
          });
          return {
            sortOrder: idx,
            ingredientId: l.ingredientId ?? null,
            banquetItemId: l.banquetItemId ?? null,
            sku: l.sku,
            description: l.description,
            unit: l.unit,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            gstRatePct: l.gstRatePct?.trim() || "0",
            lineSubtotal: subtotal.toString(),
            lineTax: tax.toString(),
            lineTotal: total.toString(),
          };
        }),
      },
    },
    // Callers linking downstream records (banquet requisition lines) need
    // the created line ids back.
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });

  // M16: back-link chef requisition lines this PO is buying for (?reqId=
  // prefill flow) — GRN acceptance then flips them back to issuable and
  // notifies the store + chef, mirroring the banquet vendorPOLineId link.
  // Guarded on AWAITING_PROCUREMENT so a stale/duplicate prefill can't
  // rewire a line that was already issued, cancelled or re-procured.
  for (let idx = 0; idx < input.lines.length; idx++) {
    const chefReqLineId = input.lines[idx].chefReqLineId;
    if (!chefReqLineId) continue;
    await tx.chefRequisitionLine.updateMany({
      where: { id: chefReqLineId, status: ChefRequisitionLineStatus.AWAITING_PROCUREMENT },
      data: { vendorPOLineId: created.lines[idx].id },
    });
  }

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
