import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listBanquetItems } from "@/server/actions/banquet";
import { ReceiptForm } from "./_components/ReceiptForm";

export const dynamic = "force-dynamic";

export default async function NewBanquetReceiptPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER]);
  const items = await listBanquetItems({ activeOnly: true });

  return (
    <>
      <PageHeader
        eyebrow="Banquet store"
        title="Record receipt"
        description="Stock IN — items purchased from a vendor or transferred into the banquet store."
        actions={<Link href="/banquet/receipts"><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      {items.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          No items in the catalog yet.{" "}
          <Link href="/banquet/items" className="text-brand hover:underline">Add some first</Link>.
        </p>
      ) : (
        <ReceiptForm
          items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category }))}
        />
      )}
    </>
  );
}
