import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { declareIngredientReturn, listDeclarableIssues } from "@/server/actions/inventory";
import { formatIST } from "@/lib/time";
import { ReturnForm } from "../new/_components/ReturnForm";
import type { IngredientReturnInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

/**
 * The chef's half of the handover: say what's going back, then physically
 * send it. Nothing moves here — the store books it in when it arrives, and
 * corrects the quantity if less turned up than was declared.
 *
 * Same gate as declareIngredientReturn (KITCHEN_HEAD + management), and the
 * same table as the store's own screen: the cap column is the one that
 * changes, because a second declaration can't promise stock the first one
 * already did.
 */
export default async function DeclareReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD]);

  const { orderId } = await searchParams;
  const issues = await listDeclarableIssues({ orderId });
  const scopedCode = orderId ? issues[0]?.orderCode ?? null : null;

  async function submit(input: IngredientReturnInputT) {
    "use server";
    return declareIngredientReturn(input);
  }

  return (
    <>
      <PageHeader
        eyebrow={orderId ? `Kitchen · ${scopedCode ?? "Order"}` : "Kitchen"}
        title={
          orderId
            ? "Declare leftover stock going back for this order"
            : "Declare leftover stock going back to the store"
        }
        description={
          (orderId ? "Only what you drew on this order is listed. " : "") +
          "Say what you're sending back and why. Nothing moves yet — the store confirms what actually reaches the counter, and that's when the stock goes back and the order is credited. Anything you've already declared and are still waiting on is taken off the figure you can declare."
        }
      />
      <ReturnForm
        issues={issues.map((i) => ({
          ...i,
          issuedAt: formatIST(i.issuedAt),
          // The chef's ceiling is what hasn't already been promised.
          returnable: i.declarable,
        }))}
        onSubmit={submit}
        submitLabel="Declare return"
        successMessage="Declared — the store will confirm it when the stock reaches them"
        redirectTo={orderId ? `/orders/${orderId}` : "/dashboard"}
        capLabel="Can still declare"
        emptyMessage="Nothing left to send back — everything you drew has either come back already or is declared and waiting on the store."
      />
    </>
  );
}
