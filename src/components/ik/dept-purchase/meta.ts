import type { DeptPurchaseStatus, StoreDepartment } from "@prisma/client";
import type { PillTone } from "@/components/ik/Pill";

/** Client-safe labels for the department stock request / PO screens. */

export const DEPT: Record<StoreDepartment, { label: string; base: string }> = {
  HOUSEKEEPING: { label: "Housekeeping", base: "/housekeeping" },
  MAINTENANCE: { label: "Maintenance", base: "/maintenance" },
};

export const STATUS: Record<DeptPurchaseStatus, { label: string; tone: PillTone }> = {
  DRAFT: { label: "Draft", tone: "ink" },
  PENDING_APPROVAL: { label: "Awaiting approval", tone: "amber" },
  APPROVED: { label: "Approved", tone: "blue" },
  REJECTED: { label: "Rejected", tone: "alert" },
  ORDERED: { label: "Ordered", tone: "accent" },
  PARTIALLY_RECEIVED: { label: "Part received", tone: "amber" },
  RECEIVED: { label: "Received", tone: "positive" },
  CANCELLED: { label: "Cancelled", tone: "ink" },
};

export const LIST_TABS: Array<{ key: string; label: string; statuses?: DeptPurchaseStatus[] }> = [
  { key: "open", label: "Open", statuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] },
  { key: "pending", label: "Awaiting approval", statuses: ["PENDING_APPROVAL"] },
  { key: "receive", label: "To order / receive", statuses: ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] },
  { key: "closed", label: "Closed", statuses: ["RECEIVED", "REJECTED", "CANCELLED"] },
  { key: "all", label: "All" },
];
