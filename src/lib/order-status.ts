import { OrderStatus } from "@prisma/client";

/**
 * Human-friendly labels for OrderStatus. The DB enum values are
 * code-friendly (PENDING_CHEF_APPROVAL); the UI should show plain English
 * (Awaiting chef approval). Single source of truth so admin / manager /
 * chef / driver all see the same wording.
 */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: "Draft",
  PENDING_ADMIN_APPROVAL: "Awaiting admin approval",
  REJECTED_BY_ADMIN: "Rejected by admin",
  PENDING_CHEF_APPROVAL: "Awaiting chef approval",
  CHANGES_PROPOSED_BY_CHEF: "Changes proposed — manager to review",
  CHEF_APPROVED: "Chef approved",
  CHEF_REQUISITION_PENDING: "Chef to raise requisition",
  ISSUING: "Store issuing ingredients",
  READY_FOR_PRODUCTION: "Ready to cook",
  IN_PREP: "Cooking",
  READY: "Ready for dispatch",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  INVOICED: "Invoiced",
  PAID: "Paid",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED_BY_MANAGER: "Rejected by manager",
  // Workflow-v1 statuses — no new orders take these but old rows might
  // still carry them. Clean labels (no "[legacy]" prefix) so the UI
  // reads consistently for the operator.
  PENDING_STORE_APPROVAL: "Pending store approval",
  PENDING_MANAGER_APPROVAL: "Pending manager approval",
  REJECTED_BY_STORE: "Rejected by store",
  APPROVED: "Approved",
};

/**
 * Tone hint for status badges (positive / pending / alert / neutral).
 */
export const STATUS_TONE: Record<OrderStatus, "neutral" | "pending" | "positive" | "alert"> = {
  DRAFT: "neutral",
  PENDING_ADMIN_APPROVAL: "pending",
  REJECTED_BY_ADMIN: "alert",
  PENDING_CHEF_APPROVAL: "pending",
  CHANGES_PROPOSED_BY_CHEF: "pending",
  CHEF_APPROVED: "positive",
  CHEF_REQUISITION_PENDING: "pending",
  ISSUING: "pending",
  READY_FOR_PRODUCTION: "pending",
  IN_PREP: "pending",
  READY: "positive",
  OUT_FOR_DELIVERY: "pending",
  DELIVERED: "positive",
  INVOICED: "positive",
  PAID: "positive",
  COMPLETED: "positive",
  CANCELLED: "alert",
  REJECTED_BY_MANAGER: "alert",
  PENDING_STORE_APPROVAL: "neutral",
  PENDING_MANAGER_APPROVAL: "neutral",
  REJECTED_BY_STORE: "alert",
  APPROVED: "neutral",
};

/**
 * The happy-path linear flow of an order, used to render the horizontal
 * stepper on the order detail page. Branch states (CHANGES_PROPOSED_BY_CHEF,
 * REJECTED_BY_*, CANCELLED) aren't in the line — when current status is
 * one of those, the stepper highlights the parent stage and shows the
 * branch as a separate annotation.
 *
 * v3 adds an "Admin review" stop between Draft and Chef review.
 */
export const STAGE_FLOW: Array<{ status: OrderStatus; short: string }> = [
  { status: OrderStatus.DRAFT, short: "Draft" },
  { status: OrderStatus.PENDING_ADMIN_APPROVAL, short: "Admin review" },
  { status: OrderStatus.PENDING_CHEF_APPROVAL, short: "Chef review" },
  { status: OrderStatus.CHEF_REQUISITION_PENDING, short: "Requisition" },
  { status: OrderStatus.ISSUING, short: "Issuing" },
  { status: OrderStatus.READY_FOR_PRODUCTION, short: "To cook" },
  { status: OrderStatus.IN_PREP, short: "Cooking" },
  { status: OrderStatus.READY, short: "Ready" },
  { status: OrderStatus.OUT_FOR_DELIVERY, short: "Delivery" },
  { status: OrderStatus.DELIVERED, short: "Delivered" },
  { status: OrderStatus.INVOICED, short: "Invoiced" },
  { status: OrderStatus.PAID, short: "Paid" },
];

/** Index of `status` in STAGE_FLOW, or -1 for off-path statuses. */
export function stageIndex(status: OrderStatus): number {
  return STAGE_FLOW.findIndex((s) => s.status === status);
}

/** Where the stepper should highlight when current is an off-path branch. */
export function effectiveStageIndex(status: OrderStatus): number {
  switch (status) {
    case OrderStatus.REJECTED_BY_ADMIN:
      return stageIndex(OrderStatus.PENDING_ADMIN_APPROVAL);
    case OrderStatus.CHANGES_PROPOSED_BY_CHEF:
      return stageIndex(OrderStatus.PENDING_CHEF_APPROVAL);
    case OrderStatus.CHEF_APPROVED:
      return stageIndex(OrderStatus.CHEF_REQUISITION_PENDING);
    case OrderStatus.REJECTED_BY_MANAGER:
      return stageIndex(OrderStatus.PENDING_CHEF_APPROVAL);
    case OrderStatus.CANCELLED:
      return -1;
    default:
      return stageIndex(status);
  }
}
