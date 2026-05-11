import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { listCustomerGroups } from "@/server/actions/customer-groups";
import { deactivateCustomer, getCustomer, reactivateCustomer, updateCustomer } from "@/server/actions/customers";
import { CustomerForm } from "../_components/CustomerForm";
import type { CustomerInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [customer, groups] = await Promise.all([
    getCustomer(id),
    listCustomerGroups({ active: true }),
  ]);
  if (!customer) notFound();

  async function update(input: CustomerInputT) {
    "use server";
    await updateCustomer(id, input);
    return { id };
  }
  async function deactivate() {
    "use server";
    await deactivateCustomer(id);
  }
  async function reactivate() {
    "use server";
    await reactivateCustomer(id);
  }

  return (
    <>
      <PageHeader
        eyebrow={`Customer · ${customer.active ? "Active" : "Inactive"}`}
        title={customer.name}
        description={customer.gstin ? `GSTIN ${customer.gstin}` : "No GSTIN on file"}
        actions={
          <div className="flex gap-2">
            <Link href="/customers"><Button variant="outline">Back to list</Button></Link>
            {customer.active ? (
              <form action={deactivate}>
                <Button variant="outline" type="submit">Deactivate</Button>
              </form>
            ) : (
              <form action={reactivate}>
                <Button variant="outline" type="submit">Reactivate</Button>
              </form>
            )}
          </div>
        }
      />

      <CustomerForm
        defaults={{
          name: customer.name,
          gstin: customer.gstin,
          pan: customer.pan,
          billingAddress: customer.billingAddress,
          shippingAddress: customer.shippingAddress,
          stateCode: customer.stateCode,
          contactName: customer.contactName,
          email: customer.email,
          phone: customer.phone,
          notes: customer.notes,
          groupId: customer.groupId,
        }}
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        onSubmit={update}
        submitLabel="Save changes"
      />
    </>
  );
}
