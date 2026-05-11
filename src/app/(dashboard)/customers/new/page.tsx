import { PageHeader } from "@/components/ui/page-header";
import { listCustomerGroups } from "@/server/actions/customer-groups";
import { createCustomer } from "@/server/actions/customers";
import { CustomerForm } from "../_components/CustomerForm";
import type { CustomerInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const groups = await listCustomerGroups({ active: true });

  async function submit(input: CustomerInputT) {
    "use server";
    return createCustomer(input);
  }

  return (
    <>
      <PageHeader eyebrow="Sales · Customers" title="New customer" />
      <CustomerForm
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        onSubmit={submit}
        submitLabel="Create customer"
        redirectOnSuccess="/customers/:id"
      />
    </>
  );
}
