import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { listIngredients, recordDirectIngredientIssue } from "@/server/actions/inventory";
import { listOrders } from "@/server/actions/orders";
import { IssueForm } from "./_components/IssueForm";
import type { IngredientIssueInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function NewIssuePage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  // Admin, manager, storekeeper, accounts can attribute stock to an
  // order. Chef and delivery do not enter this surface.
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.ACCOUNTS]);

  const { orderId } = await searchParams;
  const [ingredients, orders] = await Promise.all([
    listIngredients({ active: true }),
    listOrders({}),
  ]);

  async function submit(input: IngredientIssueInputT) {
    "use server";
    return recordDirectIngredientIssue(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Record stock used for an order"
        description={
          orderId
            ? "Pre-filled to the order you came from. Pick the ingredient and quantity used — the cost is captured at the current moving-average price and shows up on the order P&L."
            : "Tag stock to a specific order so it counts toward that order's cost. Useful for last-minute additions outside the chef requisition flow."
        }
      />
      <IssueForm
        ingredients={ingredients.map((i) => ({
          id: i.id,
          sku: i.sku,
          name: i.name,
          unit: i.unit,
          onHandQty: i.onHandQty.toString(),
        }))}
        orders={orders.map((o) => ({ id: o.id, code: o.code, customerName: o.customer.name }))}
        initialOrderId={orderId ?? null}
        onSubmit={submit}
      />
    </>
  );
}
