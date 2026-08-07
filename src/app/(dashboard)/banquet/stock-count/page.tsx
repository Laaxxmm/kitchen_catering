import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listBanquetItems, postBanquetStockCount } from "@/server/actions/banquet";
import { STOCK_EDIT_ROLES } from "@/lib/stock-movement";
import { StockCountForm } from "./_components/StockCountForm";

export const dynamic = "force-dynamic";

export default async function BanquetStockCountPage() {
  // A posted count sets on-hand by hand, audit trail or not — same gate as
  // the kitchen count and both adjust screens. The team counts; a manager posts.
  await gateRolePage(STOCK_EDIT_ROLES);
  const items = await listBanquetItems({ activeOnly: true });

  async function post(input: {
    lines: Array<{ itemId: string; countedQty: string }>;
    notes: string | null;
  }) {
    "use server";
    return postBanquetStockCount(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="Banquet · Stock"
        title="Stock count (bulk)"
        description="Walk the store, enter counted quantities row-wise, post once. Blank rows are skipped; only rows that differ from on-hand are posted. Every change is audit-logged."
        actions={<Link href="/banquet"><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      <StockCountForm
        items={items.map((i) => ({
          id: i.id,
          name: i.name,
          category: i.category,
          unit: i.unit,
          current: i.currentStock.toString(),
        }))}
        onSubmit={post}
      />
    </>
  );
}
