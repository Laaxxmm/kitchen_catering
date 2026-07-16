import Link from "next/link";
import { redirect } from "next/navigation";
import { Role, VendorPOStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { listVendors } from "@/server/actions/vendors";
import { createVendorBill, getVendorPO, listVendorPOs } from "@/server/actions/procurement";
import { toDecimal } from "@/lib/money";
import { VendorBillForm } from "./_components/VendorBillForm";

export const dynamic = "force-dynamic";

export default async function NewVendorBillPage({
  searchParams,
}: {
  searchParams: Promise<{ poId?: string }>;
}) {
  // Finance desk only — store keepers / chefs never record supplier bills.
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS, Role.STORE_KEEPER]);
  const { poId } = await searchParams;

  const [vendors, pos, po] = await Promise.all([
    listVendors({ active: true }),
    listVendorPOs({
      status: [
        VendorPOStatus.PARTIALLY_RECEIVED,
        VendorPOStatus.RECEIVED,
        VendorPOStatus.SENT,
        VendorPOStatus.APPROVED,
      ],
    }),
    poId ? getVendorPO(poId) : Promise.resolve(null),
  ]);

  // Pre-fill the bill from the PO. We use *received* qty as the default
  // since the supplier bills for what was actually delivered; if no GRN
  // has been logged yet, fall back to the ordered qty so the user only
  // has to tweak numbers, not retype them.
  const prefillLines = po
    ? po.lines.map((l) => {
        const receivedQty = toDecimal(l.receivedQty);
        const orderedQty = toDecimal(l.quantity);
        const qty = receivedQty.gt(0) ? receivedQty : orderedQty;
        return {
          description: l.description,
          quantity: qty.toString(),
          unit: l.unit,
          unitPrice: l.unitPrice.toString(),
          gstRatePct: l.gstRatePct.toString(),
        };
      })
    : null;

  async function create(input: {
    vendorId: string;
    poId: string | null;
    vendorBillNo: string | null;
    issueDate: string | undefined;
    dueDate: string | null;
    notes: string | null;
    lines: Array<{ description: string; quantity: string; unit: string; unitPrice: string; gstRatePct: string }>;
  }) {
    "use server";
    const r = await createVendorBill(input);
    if (!r.ok) return r;
    redirect(`/procurement/vendor-bills/${r.id}`);
  }

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="New supplier bill"
        description={
          po
            ? `Pre-filled from PO ${po.poNo}. Confirm the line amounts match the supplier's invoice, then save — the 3-way match runs automatically.`
            : "Capture the supplier's invoice. If you link a PO, the 3-way match (bill ↔ PO ↔ delivery note) runs automatically when you save."
        }
      />

      {po && (
        <div className="mb-4 rounded-md border border-brand-200 bg-brand-50 p-3 text-[13px] text-ik-ink-2">
          <strong>From purchase order:</strong>{" "}
          <Link href={`/procurement/purchase-orders/${po.id}`} className="font-mono text-brand hover:underline">
            {po.poNo}
          </Link>{" "}
          · supplier {po.vendor.name}. Quantities below default to what was actually delivered (the GRN
          numbers). Tweak the <em>Unit ₹</em> to match the supplier&apos;s invoice exactly.
        </div>
      )}

      <VendorBillForm
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, code: v.code }))}
        pos={pos.map((p) => ({ id: p.id, poNo: p.poNo, vendorId: p.vendorId, vendorName: p.vendor.name }))}
        onSubmit={create}
        initialVendorId={po?.vendorId ?? null}
        initialPoId={poId ?? null}
        initialLines={prefillLines}
      />
    </>
  );
}
