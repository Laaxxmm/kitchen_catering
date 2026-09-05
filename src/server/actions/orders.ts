/**
 * No "use server" here on purpose: a directive file may only export async
 * functions it defines, so it cannot re-export. The stage files carry the
 * directive; this file only forwards their action references.
 *
 * The orders lifecycle, one stage per file under ./orders/. This barrel keeps
 * `@/server/actions/orders` as the import path every caller already uses.
 *
 * Stages:
 *   create     Taking the order. Create, edit while it is still a draft, and submit it into the
 *   approve    The approval chain. Admin sign-off on the commercials, the chef's feasibility
 *   revise     Changing an order the kitchen has already seen. The revision itself, the urgency
 *   close      Ending an order. Cancel (and unwind everything open against it), force-deliver,
 *   read       Reads. The lists every desk's board is built from, the status counts, and the one
 */

export { createOrder, updateOrderDraft, submitOrder } from "./orders/create";
export { adminApproveOrder, chefApproveOrder, managerApproveChefSuggestion, swapOrderItemDish, storeApproveOrder, managerApproveOrder, managerOverrideStoreRejection, assignKitchenSupervisor } from "./orders/approve";
export { reviseOrder, listRevisedOrders, acknowledgeOrderRevision, acknowledgeRevisedDocument } from "./orders/revise";
export type { RevisedOrderRow } from "./orders/revise";
export { cancelOrder, forceDeliverOrder, closeOrder, markInHouseServed, allocateOrderFeedback } from "./orders/close";
export { getOrderStatusCounts, listOrders, listUpcomingOrdersForStore, getOrder } from "./orders/read";
export type { OrderFilter } from "./orders/read";
