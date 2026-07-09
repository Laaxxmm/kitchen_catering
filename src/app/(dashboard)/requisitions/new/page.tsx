import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { createIngredient, listIngredients } from "@/server/actions/inventory";
import type { ActionResultWith } from "@/lib/action-result";
import { StandaloneReqForm } from "./_components/StandaloneReqForm";

export const dynamic = "force-dynamic";

export default async function NewStandaloneRequisitionPage() {
  // The chef (and admin) raise standalone kitchen stock requests.
  await gateRolePage([Role.ADMIN, Role.KITCHEN_HEAD]);
  const ingredients = await listIngredients({ active: true });

  // Inline ingredient creator — the chef adds a missing catalogue item
  // right here instead of leaving for /inventory/ingredients/new. Opening
  // qty is omitted so it starts at 0 on hand; the requisition's shortage
  // path (AWAITING_PROCUREMENT) covers it. Gated inside createIngredient
  // (CATALOG_ROLES includes KITCHEN_HEAD).
  async function quickAddIngredient(input: {
    sku: string;
    name: string;
    unit: string;
    subStore: "VEGETABLE" | "GROCERY" | "MILK" | "WATER" | "OTHER";
    category?: string;
  }): Promise<ActionResultWith<{ id: string }>> {
    "use server";
    return await createIngredient({
      sku: input.sku,
      name: input.name,
      unit: input.unit,
      subStore: input.subStore,
      category: input.category ?? null,
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Make & deliver"
        title="New stock request"
        description="Ask the store for ingredients not tied to any order — general prep, low kitchen stock, replacements."
        actions={<Link href="/requisitions"><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      <StandaloneReqForm
        ingredients={ingredients.map((i) => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit }))}
        onQuickAddIngredient={quickAddIngredient}
      />
    </>
  );
}
