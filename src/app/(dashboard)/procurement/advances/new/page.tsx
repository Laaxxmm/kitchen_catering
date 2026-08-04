import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listVendors } from "@/server/actions/vendors";
import { db } from "@/server/db";
import { AdvanceForm } from "./_components/AdvanceForm";

export const dynamic = "force-dynamic";

/** Record money paid to a supplier BEFORE their bill exists (item #12).
 *  The advance sits against the vendor and is applied to a bill later. */
export default async function NewVendorAdvancePage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);

  const [vendors, openPos] = await Promise.all([
    listVendors({ active: true }),
    db.vendorPO.findMany({
      where: { status: { in: ["APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED"] } },
      select: { id: true, poNo: true, vendorId: true },
      orderBy: { issueDate: "desc" },
      take: 300,
    }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Record advance payment"
        description="Money already paid to a supplier ahead of their bill. When the bill is recorded, apply the advance to it from the bill page — it posts as a real payment."
        actions={<Link href="/procurement/vendor-bills"><Button variant="outline">Back to supplier bills</Button></Link>}
      />
      <AdvanceForm
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, code: v.code }))}
        pos={openPos.map((p) => ({ id: p.id, poNo: p.poNo, vendorId: p.vendorId }))}
      />
    </>
  );
}
