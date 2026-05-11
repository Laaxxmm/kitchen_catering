import { PageHeader } from "@/components/ui/page-header";
import { listIngredients, recordIngredientReceipt } from "@/server/actions/inventory";
import { ReceiptForm } from "../../_components/ReceiptForm";
import type { IngredientReceiptInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function NewReceiptPage() {
  const ingredients = await listIngredients({ active: true });

  async function submit(input: IngredientReceiptInputT) {
    "use server";
    return recordIngredientReceipt(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Record receipt"
        description="On submit, this updates on-hand quantity and moving-average cost atomically."
      />
      <ReceiptForm
        ingredients={ingredients.map((i) => ({ id: i.id, name: i.name, sku: i.sku, unit: i.unit }))}
        onSubmit={submit}
        redirectOnSuccess="/inventory/receipts"
      />
    </>
  );
}
