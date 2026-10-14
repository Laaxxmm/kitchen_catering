import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listHousekeepingItems } from "@/server/actions/housekeeping";
import { ReceiptForm } from "./_components/ReceiptForm";

export const dynamic = "force-dynamic";

export default async function NewReceiptPage() {
  // A manager's correction path — the department receives against an
  // approved stock request at /housekeeping/purchase.
  await gateRolePage([Role.ADMIN, Role.MANAGER]);
  const items = await listHousekeepingItems({ activeOnly: true });

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="Record receipt"
        description="Manager correction — stock that came in outside a stock request. Normal deliveries are received against the request."
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
