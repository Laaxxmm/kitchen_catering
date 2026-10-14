import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listMaintenanceItems } from "@/server/actions/maintenance";
import { ReceiptForm } from "./_components/ReceiptForm";

export const dynamic = "force-dynamic";

export default async function NewReceiptPage() {
  // A direct receipt is management's correction path; the desk receives
  // against an approved stock request at /maintenance/purchase.
  await gateRolePage([Role.ADMIN, Role.MANAGER]);
  const items = await listMaintenanceItems({ activeOnly: true });

  return (
    <>
      <PageHeader
        eyebrow="Maintenance"
        title="Record receipt"
        description="A direct receipt — a correction outside the stock-request flow. Goods ordered on a stock request are received against it."
        actions={<Link href="/maintenance/receipts"><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      {items.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          No items in the catalog yet.{" "}
          <Link href="/maintenance/items" className="text-brand hover:underline">Add some first</Link>.
        </p>
      ) : (
        <ReceiptForm
          items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category }))}
        />
      )}
    </>
  );
}
