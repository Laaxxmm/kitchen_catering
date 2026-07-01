import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { IngredientForm } from "../../_components/IngredientForm";
import { createIngredient } from "@/server/actions/inventory";
import type { IngredientInputT } from "@/lib/validators";

export default async function NewIngredientPage() {
  // Store keeper + chef curate the kitchen catalogue (+ management oversight).
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.KITCHEN_HEAD]);

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
