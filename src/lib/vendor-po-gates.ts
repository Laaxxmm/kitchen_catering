import { VendorBillStatus, VendorPOStatus } from "@prisma/client";
import { humanizeStatus } from "@/lib/order-status";

/**
 * Purchase-order end-of-life decisions, and what the PO page should say
 * about the supplier bills raised against it. Pure, no DB — the action and
 * the page share them so what the server refuses and what the UI offers
 * cannot drift apart (same contract as vendor-bill-gates.ts).
 */

/**
 * The only statuses a PO can be closed from: goods actually arrived against
 * it. A PO nothing has been delivered against is a *cancellation* — and
 * cancelVendorPO additionally frees the requisition lines waiting on it.
 */
export const CLOSEABLE_PO_STATUSES: VendorPOStatus[] = [
  VendorPOStatus.PARTIALLY_RECEIVED,
  VendorPOStatus.RECEIVED,
];

/**
 * Why this PO can't be closed, in words the person holding the button can
 * act on. Closing retires the order — the balance the supplier never
 * delivered is written off — so it must never be the step that buries money
 * we still owe them.
 */
export function closeRefusal(input: {
  poNo: string;
  status: VendorPOStatus;
  /** True when any line has goods booked in against it. */
  anythingReceived: boolean;
  bills: Array<{ billNo: string; status: VendorBillStatus }>;
}): string | null {
  const { poNo, status, anythingReceived, bills } = input;
  if (status === VendorPOStatus.CLOSED) return `${poNo} is already closed.`;
  if (status === VendorPOStatus.CANCELLED) {
    return `${poNo} was cancelled — there is nothing left to close.`;
  }
  if (!CLOSEABLE_PO_STATUSES.includes(status)) {
    return `${poNo} is ${humanizeStatus(status)} and nothing has been delivered against it — cancel it instead of closing it.`;
  }
  // Goods in, no bill recorded: that liability exists nowhere in the system,
  // and a closed PO drops out of every open-PO query. Refuse.
  // Coarse on purpose — presence of a bill, not received-value vs billed-value.
  // Reconciling the two is the 3-way match's job, on the bill.
  if (anythingReceived && bills.length === 0) {
    return `Goods were received against ${poNo} but no supplier bill has been recorded. Record the bill first — closing now would hide money we still owe.`;
  }
  const unpaid = bills.filter((b) => b.status !== VendorBillStatus.PAID);
  if (unpaid.length > 0) {
    const rest = unpaid.length > 1 ? ` (and ${unpaid.length - 1} more)` : "";
    return `${unpaid[0].billNo} is ${humanizeStatus(unpaid[0].status)}${rest} — settle the supplier's bill before closing ${poNo}.`;
  }
  return null;
}

/**
 * Where a bill has got to, and what happens next. Exhaustive by type: a new
 * VendorBillStatus won't compile until it says where it sits.
 */
const BILL_STAGE: Record<VendorBillStatus, { short: string; next: string }> = {
  [VendorBillStatus.DRAFT]: {
    short: "awaiting the 3-way match",
    next: "Run the match to check it against this PO and the delivery notes.",
  },
  [VendorBillStatus.PENDING_MATCH]: {
    short: "awaiting the 3-way match",
    next: "Run the match to check it against this PO and the delivery notes.",
  },
  [VendorBillStatus.MATCHED]: {
    short: "matched, awaiting approval",
    next: "It matched this PO — accounts approve it, then it can be paid.",
  },
  [VendorBillStatus.DISCREPANCY]: {
    short: "in discrepancy",
    next: "It does not match what was ordered and received. Accounts must correct the amounts or approve it with a written reason; nothing is paid until they do.",
  },
  [VendorBillStatus.APPROVED]: {
    short: "approved, awaiting payment",
    next: "Approved by accounts — waiting to be paid.",
  },
  [VendorBillStatus.OVERDUE]: {
    short: "approved and past due",
    next: "Approved but past its due date — accounts should pay it.",
  },
  [VendorBillStatus.PAID]: { short: "paid", next: "Paid in full. Nothing further to do." },
};

export interface POBill {
  id: string;
  billNo: string;
  status: VendorBillStatus;
}

export interface BillProgress {
  /** One line naming where the bill(s) got to. */
  headline: string;
  /** What happens next — only when there's a single bill to be specific about. */
  next: string | null;
  /** Deep-link target — only when there's exactly one bill. */
  billId: string | null;
  /** A failed match is sitting here; the banner should be loud. */
  attention: boolean;
}

/**
 * Bill state for the PO's "next step" banner. Null when no bill has been
 * recorded yet — the caller prompts for one instead.
 */
export function billProgress(bills: POBill[]): BillProgress | null {
  if (bills.length === 0) return null;
  const attention = bills.some((b) => b.status === VendorBillStatus.DISCREPANCY);
  if (bills.length === 1) {
    const stage = BILL_STAGE[bills[0].status];
    return {
      headline: `${bills[0].billNo} is ${stage.short}`,
      next: stage.next,
      billId: bills[0].id,
      attention,
    };
  }
  // Partial deliveries get billed separately, so count every stage rather
  // than reporting the first bill's status as if it were the whole picture.
  const counts = new Map<string, number>();
  for (const b of bills) {
    const { short } = BILL_STAGE[b.status];
    counts.set(short, (counts.get(short) ?? 0) + 1);
  }
  return {
    headline: `${bills.length} supplier bills recorded — ${[...counts]
      .map(([short, n]) => `${n} ${short}`)
      .join(", ")}`,
    next: null,
    billId: null,
    attention,
  };
}
