import { PageHeader } from "@/components/ui/page-header";
import { IngredientForm } from "../../_components/IngredientForm";
import { createIngredient } from "@/server/actions/inventory";
import type { IngredientInputT } from "@/lib/validators";

export default function NewIngredientPage() {
  async function submit(input: IngredientInputT) {
    "use server";
    return createIngredient(input);
  }
  return (
    <>
      <PageHeader eyebrow="Inventory" title="New ingredient" />
      <IngredientForm onSubmit={submit} submitLabel="Create ingredient" redirectOnSuccess="/inventory/ingredients/:id" />
    </>
  );
}
