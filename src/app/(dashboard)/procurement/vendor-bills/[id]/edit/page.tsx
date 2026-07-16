import { notFound, redirect } from "next/navigation";
import { Role, VendorBillStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { getVendorBill, updateVendorBill } from "@/server/actions/procurement";
import { formatIST } from "@/lib/time";
import { VendorBillForm } from "../../new/_components/VendorBillForm";

export const dynamic = "force-dynamic";

/**
 * Edit a supplier bill while it's still DRAFT / PENDING_MATCH — typo in the
 * vendor invoice number, wrong date, a line keyed in wrong. Once the bill is
 * matched/approved/paid it's a financial record; this page bounces back to
 * the detail view and the action refuses too.
 */
export default async function EditVendorBillPage({ params }: { params: Promise<{ id: string }> }) {
  // Same finance desk as bill creation (middleware gates the route too).
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS, Role.STORE_KEEPER]);
  const { id } = await params;
  const bill = await getVendorBill(id);
  if (!bill) notFound();

  const editable =
    bill.status === VendorBillStatus.DRAFT || bill.status === VendorBillStatus.PENDING_MATCH;
  if (!editable) redirect(`/procurement/vendor-bills/${id}`);

  async function save(input: {
    vendorId: string;
    poId: string | null;
    vendorBillNo: string | null;
    issueDate: string | undefined;
    dueDate: string | null;
    notes: string | null;
    lines: Array<{ description: string; quantity: string; unit: string; unitPrice: string; gstRatePct: string }>;
  }) {
    "use server";
    // Vendor + PO are locked in edit mode — only pass the editable fields.
    const r = await updateVendorBill(id, {
      vendorBillNo: input.vendorBillNo,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      notes: input.notes,
      lines: input.lines,
    });
    if (!r.ok) return r;
    redirect(`/procurement/vendor-bills/${id}`);
  }

  return (
    <>
      <PageHeader
        eyebrow={`Procurement · ${bill.vendor.name}`}
        title={`Edit ${bill.billNo}`}
        description="Fix the vendor invoice number, dates, notes or lines. Totals are recomputed on save, and any earlier 3-way match result is cleared — re-run it after."
      />
      <VendorBillForm
        vendors={[{ id: bill.vendor.id, name: bill.vendor.name, code: bill.vendor.code }]}
        pos={bill.po ? [{ id: bill.po.id, poNo: bill.po.poNo, vendorId: bill.vendorId, vendorName: bill.vendor.name }] : []}
        onSubmit={save}
        initialVendorId={bill.vendorId}
        initialPoId={bill.poId}
        initialLines={bill.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity.toString(),
          unit: l.unit,
          unitPrice: l.unitPrice.toString(),
          gstRatePct: l.gstRatePct.toString(),
        }))}
        mode="edit"
        defaults={{
          vendorBillNo: bill.vendorBillNo ?? "",
          issueDate: bill.issueDate ? formatIST(bill.issueDate, "yyyy-MM-dd") : "",
          dueDate: bill.dueDate ? formatIST(bill.dueDate, "yyyy-MM-dd") : "",
          notes: bill.notes ?? "",
        }}
        submitLabel="Save changes"
      />
    </>
  );
}
