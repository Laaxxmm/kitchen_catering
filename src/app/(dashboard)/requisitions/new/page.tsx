import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listIngredients } from "@/server/actions/inventory";
import { StandaloneReqForm } from "./_components/StandaloneReqForm";

export const dynamic = "force-dynamic";

export default async function NewStandaloneRequisitionPage() {
  // The chef (and admin) raise standalone kitchen stock requests.
  await gateRolePage([Role.ADMIN, Role.KITCHEN_HEAD]);
  const ingredients = await listIngredients({ active: true });

  // No inline ingredient creator — adding catalogue items is management-only
  // now (see CATALOG_CREATE_ROLES); the chef picks from what already exists.
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
      />
    </>
  );
}
