import { OrderStatus } from "@prisma/client";

/**
 * How loudly a revision needs to be shouted about. Pure logic, no DB —
 * shared by the reviseOrder guard, the revised-orders boards and the
 * client components that badge them, so the server's idea of "critical"
 * and the UI's can't drift.
 */
export type RevisionBand = "NORMAL" | "URGENT" | "CRITICAL";

/** Which team's copy of the alert we're reading or acknowledging. */
export type RevisionScope = "chef" | "store";

/** Downstream documents a revision can invalidate. */
export type RevisionDocumentType = "CHEF_REQUISITION" | "BANQUET_REQUISITION" | "VENDOR_PO";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Work has physically started — ingredients are in pans, or the food has
// left. Changing the order now costs money whatever the clock says.
const CRITICAL_STATUSES: OrderStatus[] = [
  OrderStatus.IN_PREP,
  OrderStatus.READY,
  OrderStatus.OUT_FOR_DELIVERY,
];

// The store/kitchen have committed a plan (requisition raised, stock being
// issued) but nothing is cooking yet — recoverable, but not quietly.
const URGENT_STATUSES: OrderStatus[] = [
  OrderStatus.CHEF_REQUISITION_PENDING,
  OrderStatus.ISSUING,
  OrderStatus.READY_FOR_PRODUCTION,
];

/**
 * Band a revision by the WORSE of two signals — time to the event and how
 * far the kitchen has already got. Time alone lies: an order three days out
 * that is already cooking is every bit as risky as one an hour away.
 */
export function computeRevisionBand({
  eventDate,
  status,
  now = new Date(),
}: {
  eventDate: Date;
  status: OrderStatus;
  now?: Date;
}): RevisionBand {
  // Signed, deliberately: a past-due event yields a negative interval and
  // must land in CRITICAL, not fall through to NORMAL.
  const msToEvent = eventDate.getTime() - now.getTime();
  if (msToEvent < HOUR_MS || CRITICAL_STATUSES.includes(status)) return "CRITICAL";
  if (msToEvent < DAY_MS || URGENT_STATUSES.includes(status)) return "URGENT";
  return "NORMAL";
}

/**
 * A downstream document (requisition, purchase order) needs re-reading when
 * the order was revised after that document was raised or last confirmed.
 * `ackAt` is the team's explicit "I've re-checked this" stamp; with none,
 * the document has stood untouched since `createdAt`.
 */
export function isStaleAfterRevision({
  lastRevisedAt,
  ackAt,
  createdAt,
}: {
  lastRevisedAt: Date | null;
  ackAt: Date | null;
  createdAt: Date;
}): boolean {
  if (!lastRevisedAt) return false;
  return lastRevisedAt.getTime() > (ackAt ?? createdAt).getTime();
}
