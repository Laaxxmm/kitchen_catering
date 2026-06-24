import Link from "next/link";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { listVendors } from "@/server/actions/vendors";
import { listIngredients } from "@/server/actions/inventory";
import { createVendorPO } from "@/server/actions/procurement";
import { getPurchaseRequisition } from "@/server/actions/purchase-requisitions";
import { gateRolePage } from "@/server/rbac";
import { VendorPOForm } from "./_components/VendorPOForm";

export const dynamic = "force-dynamic";

export default async function NewVendorPOPage({
  searchParams,
}: {
  searchParams: Promise<{ prId?: string }>;
}) {
  // Vendor selection + pricing is a manager/admin job, not the store's.
  await gateRolePage([Role.ADMIN, Role.MANAGER]);
  const { prId } = await searchParams;

  const [vendors, ingredients, pr] = await Promise.all([
    listVendors({ active: true }),
    listIngredients({ active: true }),
    prId ? getPurchaseRequisition(prId) : Promise.resolve(null),
  ]);

  // If we're spawning from a PR, pre-fill the form with that PR's lines
  // and pick the most common preferred vendor across those ingredients
  // (so the user doesn't have to retype anything).
  const prefillLines = pr
    ? pr.lines.map((l) => {
        const ing = ingredients.find((i) => i.id === l.ingredientId);
        return {
          ingredientId: l.ingredientId,
          sku: ing?.sku ?? "",
          description: ing?.name ?? "",
          unit: ing?.unit ?? "kg",
          quantity: l.requestedQty.toString(),
          unitPrice: l.unitCostSnapshot.toString(),
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
    const r = await createVendorPO({ ...input, prId: prId ?? null });
    redirect(`/procurement/purchase-orders/${r.id}`);
  }

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="New purchase order"
        description={
          pr
            ? `Filled in from request ${pr.prNo}. Confirm the supplier, set prices, then create the draft PO.`
            : "Pick a vendor, add line items, submit. The total auto-determines the approval tier."
        }
      />

      {pr && (
        <div className="mb-4 rounded-md border border-brand-200 bg-brand-50 p-3 text-[13px] text-ik-ink-2">
          <strong>From request:</strong>{" "}
          <Link href={`/procurement/purchase-requisitions/${pr.id}`} className="font-mono text-brand hover:underline">
            {pr.prNo}
          </Link>{" "}
          · {pr.lines.length} line{pr.lines.length === 1 ? "" : "s"} requested by{" "}
          {pr.requestedBy?.name ?? "—"}. The lines below are pre-filled — fill in <em>Unit ₹</em> for
          each item based on your supplier&apos;s quote.
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

