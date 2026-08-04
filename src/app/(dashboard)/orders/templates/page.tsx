import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listOrderTemplates } from "@/server/actions/order-templates";
import { listCustomers } from "@/server/actions/customers";
import { listDishes } from "@/server/actions/dishes";
import { TemplateManager } from "./_components/TemplateManager";

export const dynamic = "force-dynamic";

/** Recurring-order templates — manager/admin curate them here, then place an
 *  order from one in two taps (client item #2). */
export default async function OrderTemplatesPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER]);

  const [templates, customers, dishes] = await Promise.all([
    listOrderTemplates({ activeOnly: true }),
    listCustomers({ active: true }),
    listDishes({ active: true }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Sales · Orders"
        title="Recurring orders"
        description="Templates for orders you place again and again — office lunches, weekly buffets. Pick one on the New-order page and only the date needs touching."
        actions={<Link href="/orders"><Button variant="outline">Back to orders</Button></Link>}
      />
      <TemplateManager
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          customerId: t.customerId,
          customerName: t.customer.name,
          channel: t.channel,
          mealType: t.mealType,
          headcount: t.headcount,
          packageTotal: t.packageTotal?.toString() ?? "",
          deliveryAddress: t.deliveryAddress ?? "",
          notes: t.notes ?? "",
          items: t.items.map((it) => ({ dishId: it.dishId, dishName: it.dish.name, portions: it.portions.toString() })),
        }))}
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        dishes={dishes.map((d) => ({ id: d.id, name: d.name }))}
      />
    </>
  );
}
