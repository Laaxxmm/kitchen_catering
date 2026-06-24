import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listStoreItems } from "@/server/actions/store-stock";
import { StoreAdjustForm } from "@/components/ik/StoreAdjustForm";

export const dynamic = "force-dynamic";

export default async function BanquetAdjustPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE]);
  const items = await listStoreItems("banquet");

  return (
    <>
      <PageHeader
        eyebrow="Banquet · Stock"
        title="Adjust stock"
        description="Correct on-hand after a count, set an opening balance, or write off damaged stock. For purchased incoming stock, use Record receipt instead."
        actions={<Link href="/banquet/receipts/new"><Button variant="outline">Record receipt instead</Button></Link>}
      />
      <StoreAdjustForm store="banquet" items={items} backHref="/banquet" />
    </>
  );
}
