import { PageHeader } from "@/components/ui/page-header";
import { createCustomer, listCustomers } from "@/server/actions/customers";
import { listDishes } from "@/server/actions/dishes";
import { createQuote } from "@/server/actions/quotes";
import type { QuoteCreateInputT } from "@/lib/validators";
import { QuoteDraftForm } from "./_components/QuoteDraftForm";

export const dynamic = "force-dynamic";

export default async function NewQuotePage() {
  const [customers, dishes] = await Promise.all([
    listCustomers({ active: true }),
    listDishes({ active: true }),
  ]);

  async function submit(input: QuoteCreateInputT) {
    "use server";
    return createQuote(input);
  }

  // Inline customer creation — sales doesn't need to leave the quote
  // form to add a fresh lead. Server-side validation runs the same way
  // as the dedicated /customers/new page.
  async function quickAddCustomer(input: {
    name: string;
    billingAddress: string;
    stateCode: string;
    email?: string;
    phone?: string;
    gstin?: string;
  }): Promise<{ id: string; name: string; stateCode: string }> {
    "use server";
    const r = await createCustomer({
      name: input.name,
      billingAddress: input.billingAddress,
      stateCode: input.stateCode,
      email: input.email || null,
      phone: input.phone || null,
      gstin: input.gstin || null,
      pan: null,
      shippingAddress: null,
      contactName: null,
      notes: null,
      groupId: null,
    });
    return { id: r.id, name: input.name, stateCode: input.stateCode };
  }

  return (
    <>
      <PageHeader
        eyebrow="Sales · Quotes"
        title="New quote"
        description="Draft the lines, share with the customer, and convert to an order when they accept."
      />
      <QuoteDraftForm
        customers={customers.map((c) => ({ id: c.id, name: c.name, stateCode: c.stateCode }))}
        dishes={dishes.map((d) => ({
          id: d.id,
          name: d.name,
          code: d.code,
          unit: d.unit,
          unitPrice: d.unitPrice.toString(),
          gstRatePct: d.gstRatePct.toString(),
          hsnSac: d.hsnSac,
        }))}
        onSubmit={submit}
        onQuickAddCustomer={quickAddCustomer}
      />
    </>
  );
}
