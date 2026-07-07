import { notFound, redirect } from "next/navigation";
import { CustomerInvoiceStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { getCustomerInvoice, updateDraftInvoice } from "@/server/actions/customer-invoices";
import { gateRolePage } from "@/server/rbac";
import { InvoiceLineEditor } from "./_components/InvoiceLineEditor";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  const { id } = await params;
  const invoice = await getCustomerInvoice(id);
  if (!invoice) notFound();
  if (invoice.status !== CustomerInvoiceStatus.DRAFT) {
    redirect(`/invoices/${id}`);
  }

  async function update(input: {
    placeOfSupplyStateCode: string;
    dueDate: string | null;
    notes: string | null;
    termsMd: string | null;
    poRef: string | null;
    lines: Array<{
      description: string;
      hsnSac: string | null;
      quantity: string;
      unit: string;
      unitPrice: string;
      discountPct: string;
      gstRatePct: string;
    }>;
  }) {
    "use server";
    const res = await updateDraftInvoice(id, input);
    if (!res.ok) return res;
    redirect(`/invoices/${id}`);
  }

  return (
    <>
      <PageHeader
        eyebrow={`Invoice · ${invoice.invoiceNo} · DRAFT`}
        title="Edit lines"
        description="Edit allowed while invoice is in DRAFT only. Issuing the invoice locks the lines."
      />
      <InvoiceLineEditor
        mode="edit"
        customerLabel={invoice.customer.name}
        defaults={{
          placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
          dueDate: invoice.dueAt ? invoice.dueAt.toISOString().slice(0, 10) : null,
          notes: invoice.notes,
          termsMd: invoice.termsMd,
          poRef: invoice.poRef,
          lines: invoice.lines.map((l) => ({
            description: l.description,
            hsnSac: l.hsnSac ?? "",
            quantity: l.quantity.toString(),
            unit: l.unit,
            unitPrice: l.unitPrice.toString(),
            discountPct: l.discountPct.toString(),
            gstRatePct: l.gstRatePct.toString(),
          })),
        }}
        onSubmit={update}
        submitLabel="Save changes"
      />
    </>
  );
}
