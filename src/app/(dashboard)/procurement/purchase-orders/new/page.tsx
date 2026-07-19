import { redirect } from "next/navigation";
import { ChefRequisitionLineStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { createVendor, listVendors } from "@/server/actions/vendors";
import { listIngredients } from "@/server/actions/inventory";
import { listBanquetItems } from "@/server/actions/banquet";
import { createVendorPO } from "@/server/actions/procurement";
import { getChefRequisition } from "@/server/actions/chef-requisitions";
import { gateRolePage } from "@/server/rbac";
import { db } from "@/server/db";
import { REVISABLE_ORDER_STATUSES } from "@/lib/order-status";
import { toDecimal } from "@/lib/money";
import { VendorPOForm } from "./_components/VendorPOForm";

export const dynamic = "force-dynamic";

export default async function NewVendorPOPage({
  searchParams,
}: {
  searchParams: Promise<{ reqId?: string; lowstock?: string }>;
}) {
  // The store keeper raises the PO for a shortfall; manager/admin approve it.
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER]);
  const { reqId, lowstock } = await searchParams;
  const fromLowStock = lowstock === "1";

  const [vendors, ingredients, banquetItems, chefReq, lowStockItems, activeOrders] = await Promise.all([
    listVendors({ active: true }),
    listIngredients({ active: true }),
    listBanquetItems({ activeOnly: true }),
    reqId ? getChefRequisition(reqId) : Promise.resolve(null),
    fromLowStock ? listIngredients({ active: true, lowStock: true }) : Promise.resolve([]),
    // "For order" picker (#9/#27): orders still in the kitchen's hands —
    // that's when a PO is being raised for them. Direct scoped query is
    // fine here: the page gate above is ADMIN/MANAGER/STORE_KEEPER.
    db.order.findMany({
      where: { status: { in: REVISABLE_ORDER_STATUSES } },
      select: { id: true, code: true, customer: { select: { name: true } } },
      orderBy: { eventDate: "asc" },
      take: 200,
    }),
  ]);

  // Raised from a chef-requisition shortfall: pre-fill the short items with
  // their quantity and the unit price = each ingredient's average cost (an
  // approximate; the store/manager edits it before/at approval).
  const reqLines = chefReq
    ? chefReq.lines.filter((l) => l.status === ChefRequisitionLineStatus.AWAITING_PROCUREMENT)
    : [];
  let prefillLines = chefReq
    ? reqLines.map((l) => {
        const ing = ingredients.find((i) => i.id === l.ingredientId);
        const shortfall = toDecimal(l.requestedQty).minus(toDecimal(l.issuedQty));
        return {
          ingredientId: l.ingredientId,
          banquetItemId: "",
          // M16: back-link — createVendorPOTx sets this line's
          // vendorPOLineId so the GRN can flip it back to issuable.
          chefReqLineId: l.id as string | null,
          sku: l.ingredient.sku,
          description: l.ingredient.name,
          unit: l.ingredient.unit,
          quantity: shortfall.toString(),
          unitPrice: l.ingredient.avgUnitCost.toString(),
          gstRatePct: ing?.gstRatePct?.toString() ?? "5",
        };
      })
    : null;

  // Reorder all low-stock ingredients in one PO. Quantity defaults to the
  // reorder level (top-up target) and the unit price to the average cost —
  // both editable before the PO is created.
  if (fromLowStock) {
    prefillLines = lowStockItems.map((i) => ({
      ingredientId: i.id,
      banquetItemId: "",
      chefReqLineId: null,
      sku: i.sku,
      description: i.name,
      unit: i.unit,
      quantity: (toDecimal(i.reorderLevel).gt(0) ? toDecimal(i.reorderLevel) : toDecimal("1")).toString(),
      unitPrice: toDecimal(i.avgUnitCost).toString(),
      gstRatePct: i.gstRatePct.toString(),
    }));
  }

  // Suggested vendor — left null for now; future work: read each
  // ingredient's preferredVendorId and pick the most common one. For now
  // the form falls back to the first vendor in the dropdown so the user
  // just picks the right supplier themselves.
  const suggestedVendorId: string | null = null;

  async function create(input: {
    vendorId: string;
    orderId: string | null;
    procurementType: "STANDARD" | "LOCAL" | "ONLINE";
    placeOfSupplyStateCode: string;
    expectedDate: string | undefined;
    notes: string | null;
    lines: Array<{ ingredientId: string | null; banquetItemId: string | null; chefReqLineId: string | null; sku: string; description: string; unit: string; quantity: string; unitPrice: string; gstRatePct: string }>;
  }) {
    "use server";
    // input.lines already carry banquetItemId; createVendorPO parses via
    // VendorPOCreateInput (which includes it) so it forwards untouched.
    const r = await createVendorPO(input);
    if (!r.ok) return r;
    redirect(`/procurement/purchase-orders/${r.id}`);
  }

  // Inline vendor creator — add a brand-new supplier from the PO form (e.g.
  // for a one-off online order) without leaving the page.
  async function quickAddVendor(v: { name: string; stateCode: string }) {
    "use server";
    const created = await createVendor({
      name: v.name,
      stateCode: v.stateCode,
      gstin: null,
      pan: null,
      contactName: null,
      phone: null,
      email: null,
      address: null,
      notes: null,
    });
    if (!created.ok) return created;
    return { ok: true as const, id: created.id, name: v.name, code: created.code, stateCode: v.stateCode };
  }

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="New purchase order"
        description={
          chefReq
            ? `Filled in from kitchen requisition ${chefReq.requisitionNo}. Confirm the supplier, adjust prices, then create the PO.`
            : fromLowStock
              ? "Reordering low-stock items. Confirm the supplier, edit quantities/prices, then create the PO."
              : "Pick a vendor, add line items, submit. The total auto-determines the approval tier."
        }
      />

      {chefReq && (
        <div className="mb-4 rounded-md border border-brand-200 bg-brand-50 p-3 text-[13px] text-ik-ink-2">
          <strong>From kitchen requisition {chefReq.requisitionNo}</strong> ·{" "}
          {reqLines.length} short item{reqLines.length === 1 ? "" : "s"}. Prices are pre-filled from
          each item&apos;s average cost — <strong>edit them</strong> to match the supplier&apos;s
          quote. The total decides the approval: under ₹5,000 the manager signs off; ₹5,000 and above
          needs admin.
        </div>
      )}

      {fromLowStock && (
        <div className="mb-4 rounded-md border border-brand-200 bg-brand-50 p-3 text-[13px] text-ik-ink-2">
          <strong>Reordering {lowStockItems.length} low-stock item{lowStockItems.length === 1 ? "" : "s"}.</strong>{" "}
          Quantities and prices are pre-filled — <strong>edit them</strong>, pick the vendor, then
          create the PO. Under ₹5,000 the manager approves; ₹5,000 and above needs admin.
        </div>
      )}

      <VendorPOForm
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, code: v.code, stateCode: v.stateCode }))}
        ingredients={ingredients.map((i) => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, gstRatePct: i.gstRatePct.toString() }))}
        banquetItems={banquetItems.map((b) => ({ id: b.id, sku: b.sku ?? "", name: b.name, unit: b.unit }))}
        orders={[
          // The requisition's own order first (even if it moved past the
          // "active" window) so the prefill's default selection resolves.
          ...(chefReq?.order && !activeOrders.some((o) => o.id === chefReq.order!.id)
            ? [{ id: chefReq.order.id, code: chefReq.order.code, customerName: chefReq.order.customer.name }]
            : []),
          ...activeOrders.map((o) => ({ id: o.id, code: o.code, customerName: o.customer.name })),
        ]}
        initialOrderId={chefReq?.order?.id ?? null}
        onSubmit={create}
        onQuickAddVendor={quickAddVendor}
        initialVendorId={suggestedVendorId}
        initialLines={prefillLines}
      />
    </>
  );
}

