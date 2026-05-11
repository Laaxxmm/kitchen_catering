import { PageHeader } from "@/components/ui/page-header";
import { listCustomers } from "@/server/actions/customers";
import { listDishes } from "@/server/actions/dishes";
import { createOrder } from "@/server/actions/orders";
import { OrderForm } from "../_components/OrderForm";
import type { OrderCreateInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const [customers, dishes] = await Promise.all([
    listCustomers({ active: true }),
    listDishes({ active: true }),
  ]);

  async function submit(input: OrderCreateInputT) {
    "use server";
    return createOrder(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="Sales · Orders"
        title="New order"
        description="Saves as DRAFT. Submit from the detail page to send for store approval."
      />
      <OrderForm
        customers={customers.map((c) => ({ id: c.id, name: c.name, stateCode: c.stateCode }))}
        dishes={dishes.map((d) => ({
          id: d.id,
          name: d.name,
          code: d.code,
          unitPrice: d.unitPrice.toString(),
          gstRatePct: d.gstRatePct.toString(),
        }))}
        onSubmit={submit}
        submitLabel="Create draft"
        redirectOnSuccess="/orders/:id"
      />
    </>
  );
}
