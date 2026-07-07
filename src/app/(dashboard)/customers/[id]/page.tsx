import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { listCustomerGroups } from "@/server/actions/customer-groups";
import { deactivateCustomer, getCustomer, reactivateCustomer, updateCustomer } from "@/server/actions/customers";
import { listOrders } from "@/server/actions/orders";
import { CustomerForm } from "../_components/CustomerForm";
import { CustomerOrders } from "./_components/CustomerOrders";
import { DetailTabs } from "@/components/ik/DetailTabs";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import type { CustomerInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [customer, groups, orders] = await Promise.all([
    getCustomer(id),
    listCustomerGroups({ active: true }),
    listOrders({ customerId: id }),
  ]);
  if (!customer) notFound();

  async function update(input: CustomerInputT) {
    "use server";
    const res = await updateCustomer(id, input);
    if (!res.ok) return res;
    return { ok: true as const, id };
  }
  async function deactivate() {
    "use server";
    return await deactivateCustomer(id);
  }
  async function reactivate() {
    "use server";
    return await reactivateCustomer(id);
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
              <ActionResultButton action={deactivate} variant="outline" successMessage="Customer deactivated">
                Deactivate
              </ActionResultButton>
            ) : (
              <ActionResultButton action={reactivate} variant="outline" successMessage="Customer reactivated">
                Reactivate
              </ActionResultButton>
            )}
          </div>
        }
      />

      <DetailTabs
        tabs={[
          {
            key: "details",
            label: "Details",
            content: (
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
                  phone: customer.phone ?? "",
                  notes: customer.notes,
                  groupId: customer.groupId,
                  billingCompanyName: customer.billingCompanyName,
                  creditLimit: customer.creditLimit.toString(),
                  creditDays: customer.creditDays,
                }}
                groups={groups.map((g) => ({ id: g.id, name: g.name }))}
                onSubmit={update}
                submitLabel="Save changes"
              />
            ),
          },
          {
            key: "orders",
            label: "Orders",
            count: orders.length,
            content: (
              <CustomerOrders
                orders={orders.map((o) => ({
                  id: o.id,
                  code: o.code,
                  eventDate: o.eventDate.toISOString(),
                  mealType: o.mealType,
                  headcount: o.headcount,
                  contractValue: o.contractValue.toString(),
                  status: o.status,
                }))}
              />
            ),
          },
        ]}
      />
    </>
  );
}
