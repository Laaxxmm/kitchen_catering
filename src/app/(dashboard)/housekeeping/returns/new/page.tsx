import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { listReusableInCirculation } from "@/server/actions/housekeeping";
import { ReturnForm } from "./_components/ReturnForm";

export const dynamic = "force-dynamic";

export default async function HousekeepingReturnPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const items = await listReusableInCirculation();

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping · Reusables"
        title="Return linen / towels"
        description="Bring reusable items back into clean stock after a wash — or write off any that were lost or damaged."
      />
      <ReturnForm items={items} />
    </>
  );
}
