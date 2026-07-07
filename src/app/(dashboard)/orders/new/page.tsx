import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { createCustomer, listCustomers } from "@/server/actions/customers";
import { listDishes } from "@/server/actions/dishes";
import { createOrder } from "@/server/actions/orders";
import { gateRolePage } from "@/server/rbac";
import { OrderForm } from "../_components/OrderForm";
import type { OrderCreateInputT } from "@/lib/validators";
import type { ActionResultWith } from "@/lib/action-result";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  // SALES (+ MANAGER + ADMIN) take catering orders; the F&B Service team
  // (role DELIVERY, FNB_SERVICE its retired alias) takes room-service / à la
  // carte / management orders. Other roles hitting this URL directly get
  // redirected to /forbidden.
  const session = await gateRolePage([Role.ADMIN, Role.MANAGER, Role.SALES, Role.FNB_SERVICE, Role.DELIVERY]);
  // F&B Service only takes in-house room orders — those auto-attach the
  // House / Walk-in customer, so they don't get the customer list (and can't
  // browse every client). Only the catering roles pick a named customer.
  const inHouseOnly = session.user.role === Role.DELIVERY || session.user.role === Role.FNB_SERVICE;
  const [customers, dishes] = await Promise.all([
    inHouseOnly ? Promise.resolve([]) : listCustomers({ active: true }),
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
  }): Promise<ActionResultWith<{ id: string; name: string; stateCode: string }>> {
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
    if (!r.ok) return r;
    return { ok: true, id: r.id, name: input.name, stateCode: input.stateCode };
  }

  // Inline dish creator — clients ask for customised dishes; sales/manager
  // adds them right here and they land on the order (and the menu).
  async function quickAddDish(input: {
    name: string;
    unitPrice: string;
    gstRatePct: string;
    unit: string;
    category?: string;
  }): Promise<ActionResultWith<{ id: string }>> {
    "use server";
    const { createDish } = await import("@/server/actions/dishes");
    return await createDish({
      name: input.name,
      unitPrice: input.unitPrice,
      gstRatePct: input.gstRatePct,
      unit: input.unit,
      category: input.category ?? null,
      code: null,
      description: null,
      hsnSac: null,
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Sales · Orders"
        title="New order"
        description="Saves as DRAFT. Submit from the detail page to send for manager approval — the manager signs off before the chef sees it."
      />
      <OrderForm
        inHouseOnly={inHouseOnly}
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
        onQuickAddDish={inHouseOnly ? undefined : quickAddDish}
      />
    </>
  );
}
