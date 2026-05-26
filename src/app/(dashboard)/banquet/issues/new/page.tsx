import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listBanquetItems } from "@/server/actions/banquet";
import { IssueForm } from "./_components/IssueForm";

export const dynamic = "force-dynamic";

export default async function NewBanquetIssuePage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE]);
  const items = await listBanquetItems({ activeOnly: true });

  return (
    <>
      <PageHeader
        eyebrow="Banquet store"
        title="Issue stock"
        description="Record items issued from the banquet store to an event / room service / housekeeping use."
        actions={<Link href="/banquet/issues"><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      {items.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          No items in the catalog.{" "}
          <Link href="/banquet/items" className="text-brand hover:underline">Add some first</Link>.
        </p>
      ) : (
        <IssueForm
          items={items.map((i) => ({
            id: i.id,
            name: i.name,
            unit: i.unit,
            category: i.category,
            currentStock: i.currentStock.toString(),
          }))}
        />
      )}
    </>
  );
}
