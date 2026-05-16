import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listHousekeepingItems } from "@/server/actions/housekeeping";
import { ReceiptForm } from "./_components/ReceiptForm";

export const dynamic = "force-dynamic";

export default async function NewReceiptPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const items = await listHousekeepingItems({ activeOnly: true });

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="Record receipt"
        description="Stock received from the maintenance / purchasing team."
        actions={
          <Link href="/housekeeping/receipts">
            <Button variant="outline" size="sm">← Back</Button>
          </Link>
        }
      />
      {items.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          No items in the catalog yet.{" "}
          <Link href="/housekeeping/items" className="text-brand hover:underline">
            Add some first
          </Link>
          .
        </p>
      ) : (
        <ReceiptForm
          items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))}
        />
      )}
    </>
  );
}
