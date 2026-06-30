import { redirect } from "next/navigation";
import { ChefRequisitionLineStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { listVendors } from "@/server/actions/vendors";
import { listIngredients } from "@/server/actions/inventory";
import { createVendorPO } from "@/server/actions/procurement";
import { getChefRequisition } from "@/server/actions/chef-requisitions";
import { gateRolePage } from "@/server/rbac";
import { toDecimal } from "@/lib/money";
import { VendorPOForm } from "./_components/VendorPOForm";

export const dynamic = "force-dynamic";

export default async function NewVendorPOPage({
  searchParams,
}: {
  searchParams: Promise<{ reqId?: string }>;
}) {
  // The store keeper raises the PO for a shortfall; manager/admin approve it.
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER]);
  const { reqId } = await searchParams;

  const [vendors, ingredients, chefReq] = await Promise.all([
    listVendors({ active: true }),
    listIngredients({ active: true }),
    reqId ? getChefRequisition(reqId) : Promise.resolve(null),
  ]);

  // Raised from a chef-requisition shortfall: pre-fill the short items with
  // their quantity and the unit price = each ingredient's average cost (an
  // approximate; the store/manager edits it before/at approval).
  const reqLines = chefReq
    ? chefReq.lines.filter((l) => l.status === ChefRequisitionLineStatus.AWAITING_PROCUREMENT)
    : [];
  const prefillLines = chefReq
    ? reqLines.map((l) => {
        const ing = ingredients.find((i) => i.id === l.ingredientId);
        const shortfall = toDecimal(l.requestedQty).minus(toDecimal(l.issuedQty));
        return {
          ingredientId: l.ingredientId,
          sku: l.ingredient.sku,
          description: l.ingredient.name,
          unit: l.ingredient.unit,
          quantity: shortfall.toString(),
          unitPrice: l.ingredient.avgUnitCost.toString(),
          gstRatePct: ing?.gstRatePct?.toString() ?? "5",
        };
      })
    : null;

  // Suggested vendor — left null for now; future work: read each
  // ingredient's preferredVendorId and pick the most common one. For now
  // the form falls back to the first vendor in the dropdown so the user
  // just picks the right supplier themselves.
  const suggestedVendorId: string | null = null;

  async function create(input: {
    vendorId: string;
    placeOfSupplyStateCode: string;
    expectedDate: string | undefined;
    notes: string | null;
    lines: Array<{ ingredientId: string | null; sku: string; description: string; unit: string; quantity: string; unitPrice: string; gstRatePct: string }>;
  }) {
    "use server";
    const r = await createVendorPO({ ...input, prId: null });
    redirect(`/procurement/purchase-orders/${r.id}`);
  }

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="New purchase order"
        description={
          chefReq
            ? `Filled in from kitchen requisition ${chefReq.requisitionNo}. Confirm the supplier, adjust prices, then create the PO.`
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

      <VendorPOForm
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, code: v.code, stateCode: v.stateCode }))}
        ingredients={ingredients.map((i) => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, gstRatePct: i.gstRatePct.toString() }))}
        onSubmit={create}
        initialVendorId={suggestedVendorId}
        initialLines={prefillLines}
      />
    </>
  );
}

