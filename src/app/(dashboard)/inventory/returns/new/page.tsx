import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { listReturnableIssues, recordIngredientReturn } from "@/server/actions/inventory";
import { formatIST } from "@/lib/time";
import { ReturnForm } from "./_components/ReturnForm";
import type { IngredientReturnInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  // Whoever issues stock takes it back — same gate as /inventory/issues.
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER]);

  const { orderId } = await searchParams;
  const issues = await listReturnableIssues({ orderId });

  async function submit(input: IngredientReturnInputT) {
    "use server";
    return recordIngredientReturn(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Record stock returned from the kitchen"
        description="Each line comes back against the issue it went out on, at the price that issue charged — so the stock goes on hand and the event's food cost reverses by exactly what it was charged. You can't send back more than that issue still has outstanding."
      />
      <ReturnForm
        issues={issues.map((i) => ({ ...i, issuedAt: formatIST(i.issuedAt) }))}
        onSubmit={submit}
      />
    </>
  );
}
