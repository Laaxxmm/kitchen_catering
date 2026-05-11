import { PageHeader } from "@/components/ui/page-header";
import { listAuditTargets, postInventoryAudit } from "@/server/actions/inventory-audit";
import { InventoryNav } from "../_components/InventoryNav";
import { AuditForm } from "./_components/AuditForm";

export const dynamic = "force-dynamic";

export default async function InventoryAuditPage() {
  const ingredients = await listAuditTargets();

  async function post(input: { lines: Array<{ ingredientId: string; physicalCount: string }>; notes: string | null }) {
    "use server";
    return postInventoryAudit(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Monthly audit"
        description="Physical count vs system. Differences post as adjustment receipts/issues with the current avg cost; on-hand updates to match the physical."
      />
      <InventoryNav active="audit" />
      <AuditForm
        ingredients={ingredients.map((i) => ({
          id: i.id, sku: i.sku, name: i.name, unit: i.unit,
          system: i.onHandQty.toString(),
          avgCost: i.avgUnitCost.toString(),
        }))}
        onSubmit={post}
      />
    </>
  );
}
