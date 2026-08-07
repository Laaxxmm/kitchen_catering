import { IngredientReturnStatus } from "@prisma/client";
import type { PillTone } from "@/components/ik/StatusPill";

/** One label + tone per return state, shared by the list, the detail page
 *  and the order panel so they can't drift apart. Amber on DECLARED because
 *  it is work waiting on someone; green once the stock is actually back. */
export const RETURN_STATUS_META: Record<
  IngredientReturnStatus,
  { label: string; tone: PillTone }
> = {
  [IngredientReturnStatus.DECLARED]: { label: "Waiting on store", tone: "amber" },
  [IngredientReturnStatus.CONFIRMED]: { label: "Stock back on hand", tone: "green" },
  [IngredientReturnStatus.REJECTED]: { label: "Turned down", tone: "grey" },
};
