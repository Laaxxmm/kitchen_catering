import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listStoreItems } from "@/server/actions/store-stock";
import { STOCK_EDIT_ROLES } from "@/lib/stock-movement";
import { StoreAdjustForm } from "@/components/ik/StoreAdjustForm";

export const dynamic = "force-dynamic";

export default async function BanquetAdjustPage() {
  // Setting an F&B figure by hand is admin/manager only — the team records
  // receipts, issues and returns, which move the same stock off a document.
  await gateRolePage(STOCK_EDIT_ROLES);
  const items = await listStoreItems("banquet");

  return (
    <>
      <PageHeader
        eyebrow="Banquet · Stock"
        title="Adjust stock"
        description="Manual on-hand correction for ONE item (opening fix, write-off, damage). Setting many items? Use Stock count (bulk) — every item in one table, enter quantities row-wise, post once. For purchased incoming stock, use Record receipt instead."
        actions={
          <div className="flex gap-2">
            <Link href="/banquet/stock-count"><Button variant="outline">Stock count (bulk)</Button></Link>
            <Link href="/banquet/receipts/new"><Button variant="outline">Record receipt instead</Button></Link>
          </div>
        }
      />
      <StoreAdjustForm store="banquet" items={items} backHref="/banquet" />
    </>
  );
}
