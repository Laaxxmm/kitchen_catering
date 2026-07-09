import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listBanquetItems, postBanquetStockCount } from "@/server/actions/banquet";
import { StockCountForm } from "./_components/StockCountForm";

export const dynamic = "force-dynamic";

export default async function BanquetStockCountPage() {
  // Formal, fully-audited bulk count — the whole banquet team incl. the
  // store keeper (mirrors the kitchen bulk count; the stock.storeDirectEdit
  // toggle only gates the single-item Adjust flow).
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER]);
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
