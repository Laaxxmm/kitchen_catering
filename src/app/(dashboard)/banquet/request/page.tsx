import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listBanquetItems } from "@/server/actions/banquet";
import { RequestForm } from "./_components/RequestForm";

export const dynamic = "force-dynamic";

export default async function BanquetRequestPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER]);
  const items = await listBanquetItems({ activeOnly: true });
  return (
    <>
      <PageHeader
        eyebrow="Banquet store"
        title="Request goods from store"
        description="Ask the store keeper to procure banquet items you need. Pick the items and quantities; they raise the PO and record the GRN."
        actions={<Link href="/banquet"><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      <RequestForm
        items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, currentStock: i.currentStock.toString() }))}
      />
    </>
  );
}
