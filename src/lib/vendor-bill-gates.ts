import { VendorBillStatus } from "@prisma/client";
import { humanizeStatus } from "@/lib/order-status";
import { toDecimal } from "@/lib/money";

/**
 * When a supplier bill may be approved, edited or paid. Pure decisions, no
 * DB — shared by the payment actions, the approval action and the boards
 * that offer the buttons, so what the server refuses and what the UI offers
 * cannot drift apart.
 *
 * The client's rule: "That receipt has to be approved by the accounts team
 * and then only they can be marked paid, not before that."
 */

/**
 * The only statuses money may leave on. OVERDUE is an APPROVED bill past its
 * due date (runVendorPaymentReminders flips it) — still approved, still
 * payable. Everything else, including a MATCHED bill nobody has signed off
 * and a DISCREPANCY bill that failed the 3-way match, is not payable.
 */
export const PAYABLE_STATUSES: VendorBillStatus[] = [
  VendorBillStatus.APPROVED,
  VendorBillStatus.OVERDUE,
];

export function isPayable(status: VendorBillStatus): boolean {
  return PAYABLE_STATUSES.includes(status);
}

/** Statuses a bill can be approved from — the two outcomes of a 3-way match. */
const APPROVABLE_STATUSES: VendorBillStatus[] = [
  VendorBillStatus.MATCHED,
  VendorBillStatus.DISCREPANCY,
];

/** Why this bill can't be paid, in words the accounts desk can act on. */
export function payRefusal(billNo: string, status: VendorBillStatus): string | null {
  if (isPayable(status)) return null;
  if (status === VendorBillStatus.PAID) return `${billNo} is already paid.`;
  if (status === VendorBillStatus.DISCREPANCY) {
    return `${billNo} failed the 3-way match — correct it to what was ordered and received, or approve it with a written reason. It can't be paid as it stands.`;
  }
  if (status === VendorBillStatus.MATCHED) {
    return `${billNo} matched the PO but nobody has approved it yet — accounts must approve it before it can be paid.`;
  }
  return `${billNo} is ${humanizeStatus(status)} — a bill can only be paid once accounts have approved it.`;
}

/**
 * Why this bill can't be approved.
 *
 * The supplier's own invoice is NOT required. It was, and it stopped the
 * accounts desk dead: vendors hand the paperwork over days late or not at
 * all, and every bill sat unapprovable and therefore unpayable in the
 * meantime. The upload is still prompted for on the bill page, because the
 * document belongs on the file — it just isn't the thing that gates payment.
 * What does gate it: a bill has to have passed (or explicitly failed) the
 * 3-way match, and approving a failed match needs a written reason.
 */
export function approveRefusal(input: {
  billNo: string;
  status: VendorBillStatus;
  reason: string | null;
}): string | null {
  const { billNo, status, reason } = input;
  if (!APPROVABLE_STATUSES.includes(status)) {
    return `Cannot approve ${billNo} — it's ${humanizeStatus(status)}. Run the 3-way match first.`;
  }
  if (status === VendorBillStatus.DISCREPANCY && !reason?.trim()) {
    return `${billNo} doesn't match what was ordered and received. Either edit it down to the correct amounts, or give a written reason for approving it as it stands.`;
  }
  return null;
}

/**
 * Why this edit can't be saved. Correcting a mismatched bill is accounts
 * changing what the supplier will be paid — it needs an attributable reason.
 */
export function editRefusal(
  billNo: string,
  status: VendorBillStatus,
  reason: string | null,
): string | null {
  if (status === VendorBillStatus.DISCREPANCY && !reason?.trim()) {
    return `${billNo} failed the 3-way match — say why you're changing the amounts before saving.`;
  }
  return null;
}

/**
 * The ceiling: "we will pay only for that, not for the entire value or more".
 * Amounts are strings off a form — blank is not zero, it's a mis-keyed box.
 */
export function overpayRefusal(
  amount: string,
  grandTotal: string,
  priorPaid: string,
): string | null {
  if (!amount.trim()) return "Enter the amount being paid.";
  const outstanding = toDecimal(grandTotal).minus(toDecimal(priorPaid));
  if (toDecimal(amount).gt(outstanding)) {
    return `That's more than the outstanding balance (₹${outstanding.toFixed(2)}).`;
  }
  return null;
}
