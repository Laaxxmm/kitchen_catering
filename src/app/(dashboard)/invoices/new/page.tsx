import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { listCustomers } from "@/server/actions/customers";
import { createStandaloneCustomerInvoice } from "@/server/actions/customer-invoices";
import { gateRolePage } from "@/server/rbac";
import { InvoiceLineEditor } from "../[id]/edit/_components/InvoiceLineEditor";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  const customers = await listCustomers({ active: true });

  async function create(input: {
    customerId: string;
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
    const r = await createStandaloneCustomerInvoice(input);
    if (!r.ok) return r;
    redirect(`/invoices/${r.id}`);
  }

  return (
    <>
      <PageHeader
        eyebrow="Finance · Invoice"
        title="New standalone invoice"
        description="Ad-hoc invoice not tied to a catering order. Use this for consultations, deposits, or anything that didn't go through the order flow."
      />
      <InvoiceLineEditor
        mode="create"
        customers={customers.map((c) => ({
          id: c.id,
          name: c.name,
          stateCode: c.stateCode,
          billingAddress: c.billingAddress,
          gstin: c.gstin,
        }))}
        onSubmit={create}
        submitLabel="Create draft invoice"
      />
    </>
  );
}
