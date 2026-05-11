import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { listVendors } from "@/server/actions/vendors";
import { listIngredients } from "@/server/actions/inventory";
import { createVendorPO } from "@/server/actions/procurement";
import { VendorPOForm } from "./_components/VendorPOForm";

export const dynamic = "force-dynamic";

export default async function NewVendorPOPage() {
  const [vendors, ingredients] = await Promise.all([
    listVendors({ active: true }),
    listIngredients({ active: true }),
  ]);

  async function create(input: {
    vendorId: string;
    placeOfSupplyStateCode: string;
    expectedDate: string | undefined;
    notes: string | null;
    lines: Array<{ ingredientId: string | null; sku: string; description: string; unit: string; quantity: string; unitPrice: string; gstRatePct: string }>;
  }) {
    "use server";
    const r = await createVendorPO(input);
    redirect(`/procurement/purchase-orders/${r.id}`);
  }

  return (
    <>
      <PageHeader eyebrow="Procurement" title="New vendor PO" description="Pick a vendor, add line items, submit. The total auto-determines the approval tier." />
      <VendorPOForm
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, code: v.code, stateCode: v.stateCode }))}
        ingredients={ingredients.map((i) => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, gstRatePct: i.gstRatePct.toString() }))}
        onSubmit={create}
      />
    </>
  );
}
