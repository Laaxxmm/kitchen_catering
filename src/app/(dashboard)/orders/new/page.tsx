import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { createCustomer, listCustomers } from "@/server/actions/customers";
import { listDishes } from "@/server/actions/dishes";
import { createOrder } from "@/server/actions/orders";
import { gateRolePage } from "@/server/rbac";
import { OrderForm } from "../_components/OrderForm";
import type { OrderCreateInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  // SALES (+ MANAGER + ADMIN) take catering orders; FNB_SERVICE takes
  // room-service / à la carte / management orders. Other roles hitting
  // this URL directly get redirected to /forbidden.
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.SALES, Role.FNB_SERVICE]);
  const [customers, dishes] = await Promise.all([
    listCustomers({ active: true }),
    listDishes({ active: true }),
  ]);

  async function submit(input: OrderCreateInputT) {
    "use server";
    return createOrder(input);
  }

  // Inline customer creator so sales doesn't have to leave the form to
  // capture a brand-new lead. Same validation as /customers/new.
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
        eyebrow="Sales · Orders"
        title="New order"
        description="Saves as DRAFT. Submit from the detail page to send for admin approval — the admin signs off before the chef sees it."
      />
      <OrderForm
        customers={customers.map((c) => ({ id: c.id, name: c.name, stateCode: c.stateCode }))}
        dishes={dishes.map((d) => ({
          id: d.id,
          name: d.name,
          code: d.code,
          unitPrice: d.unitPrice.toString(),
          gstRatePct: d.gstRatePct.toString(),
          menu: d.menu,
          category: d.category,
        }))}
        onSubmit={submit}
        submitLabel="Create draft"
        redirectOnSuccess="/orders/:id"
        onQuickAddCustomer={quickAddCustomer}
      />
    </>
  );
}
