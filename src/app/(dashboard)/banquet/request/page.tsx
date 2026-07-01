import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { RequestForm } from "./_components/RequestForm";

export const dynamic = "force-dynamic";

export default async function BanquetRequestPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY]);
  return (
    <>
      <PageHeader
        eyebrow="Banquet store"
        title="Request goods from store"
        description="Ask the store keeper to procure something the banquet store doesn't stock. They raise the PO and record the GRN."
        actions={<Link href="/banquet"><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      <RequestForm />
    </>
  );
}
